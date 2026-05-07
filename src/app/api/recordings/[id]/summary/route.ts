import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    aiEnhancements,
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import {
    getAiOutputLanguageDirective,
    getDefaultSummaryPromptConfig,
    getSummaryPromptById,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

// POST - Generate summary
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));
    const presetId = (body.preset as string) || undefined;

    // Verify recording belongs to user
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    // Get transcription text
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, id))
        .limit(1);

    if (!transcription) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "No transcription available. Transcribe the recording first.",
            400,
        );
    }

    // Get user's summary prompt configuration
    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    let promptConfig: SummaryPromptConfiguration =
        getDefaultSummaryPromptConfig();
    if (userSettingsRow?.summaryPrompt) {
        const config =
            userSettingsRow.summaryPrompt as SummaryPromptConfiguration;
        promptConfig = {
            selectedPrompt: config.selectedPrompt || "general",
            customPrompts: config.customPrompts || [],
        };
    }

    // Determine which prompt to use (body override > user setting > default)
    const selectedPreset = presetId || promptConfig.selectedPrompt || "general";
    let promptTemplate = getSummaryPromptById(selectedPreset, promptConfig);

    if (!promptTemplate) {
        const defaultConfig = getDefaultSummaryPromptConfig();
        promptTemplate = getSummaryPromptById(
            defaultConfig.selectedPrompt,
            defaultConfig,
        );
        if (!promptTemplate) {
            throw new AppError(
                ErrorCode.INTERNAL_ERROR,
                "Failed to load summary prompt",
                500,
            );
        }
    }

    // Get AI credentials (prefer enhancement provider, fallback to transcription)
    const [enhancementCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, session.user.id),
                eq(apiCredentials.isDefaultEnhancement, true),
            ),
        )
        .limit(1);

    const [transcriptionCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, session.user.id),
                eq(apiCredentials.isDefaultTranscription, true),
            ),
        )
        .limit(1);

    const credentials = enhancementCredentials || transcriptionCredentials;

    if (!credentials) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "No AI provider configured",
            400,
        );
    }

    const apiKey = decrypt(credentials.apiKey);

    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    // Use a chat model, not whisper
    // If the configured model is a transcription-only model,
    // fall back to a reasonable chat model for the provider
    let model = credentials.defaultModel || "gpt-4o-mini";
    if (model.includes("whisper")) {
        // Pick a lightweight chat model appropriate for the provider
        const baseUrl = credentials.baseUrl || "";
        if (baseUrl.includes("groq")) {
            model = "llama-3.1-8b-instant";
        } else if (baseUrl.includes("together")) {
            model = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
        } else if (baseUrl.includes("openrouter")) {
            model = "openai/gpt-4o-mini";
        } else {
            model = "gpt-4o-mini";
        }
    }

    // Truncate transcription if too long
    const maxLength = 8000;
    const truncatedTranscription =
        transcription.text.length > maxLength
            ? `${transcription.text.substring(0, maxLength)}...`
            : transcription.text;

    // Apply AI output language directive (if configured) via the system
    // message rather than the user prompt. This separates concerns: the
    // user prompt carries the JSON-shape contract (English keys), the
    // system message carries the output-language preference. Smaller
    // models tend to honor this split more reliably than a combined
    // prompt where language and JSON-shape rules compete.
    const languageDirective = getAiOutputLanguageDirective(
        userSettingsRow?.aiOutputLanguage ?? null,
    );

    const prompt = promptTemplate.replace(
        "{transcription}",
        truncatedTranscription,
    );

    const baseSystem =
        "You are a helpful assistant that summarizes audio transcriptions. Always respond with valid JSON only, no markdown formatting or code fences.";
    const systemContent = languageDirective
        ? `${baseSystem} ${languageDirective}`
        : baseSystem;

    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: "system",
                content: systemContent,
            },
            {
                role: "user",
                content: prompt,
            },
        ],
        temperature: 0.5,
        max_tokens: 2000,
    });

    const rawContent = response.choices[0]?.message?.content?.trim() || "";

    // Parse the JSON response
    let summary = "";
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    try {
        // Strip markdown code fences if present
        const cleanContent = rawContent
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        const parsed = JSON.parse(cleanContent);
        summary = parsed.summary || "";
        keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
        actionItems = Array.isArray(parsed.actionItems)
            ? parsed.actionItems
            : [];
    } catch {
        // Fallback: treat entire response as summary text
        summary = rawContent;
    }

    // Atomic tombstone re-check + upsert.
    //
    // The user may have deleted the recording while the (long-running)
    // provider call was in flight. To prevent a delete that lands
    // *between* our re-check and our upsert from being silently undone,
    // we run both inside a single transaction that takes a row-level
    // write lock (`FOR UPDATE`) on the recording. The DELETE handler's
    // transaction acquires the same lock via its `UPDATE recordings`
    // tombstone write, so the two transactions serialize: either we
    // see `deletedAt` set and abort, or our upsert commits before
    // DELETE runs and DELETE then cleans up our row inside its own tx.
    // See PR #72.
    const RECORDING_TOMBSTONED = Symbol("recording-tombstoned");
    try {
        await db.transaction(async (tx) => {
            const [stillActive] = await tx
                .select({ deletedAt: recordings.deletedAt })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                    ),
                )
                .for("update")
                .limit(1);

            if (!stillActive || stillActive.deletedAt) {
                throw RECORDING_TOMBSTONED;
            }

            const [existing] = await tx
                .select()
                .from(aiEnhancements)
                .where(
                    and(
                        eq(aiEnhancements.recordingId, id),
                        eq(aiEnhancements.userId, session.user.id),
                    ),
                )
                .limit(1);

            if (existing) {
                await tx
                    .update(aiEnhancements)
                    .set({
                        summary,
                        keyPoints,
                        actionItems,
                        provider: credentials.provider,
                        model,
                    })
                    .where(eq(aiEnhancements.id, existing.id));
            } else {
                await tx.insert(aiEnhancements).values({
                    recordingId: id,
                    userId: session.user.id,
                    summary,
                    keyPoints,
                    actionItems,
                    provider: credentials.provider,
                    model,
                });
            }
        });
    } catch (txError) {
        if (txError === RECORDING_TOMBSTONED) {
            throw new AppError(
                ErrorCode.NOT_FOUND,
                "Recording was deleted",
                410,
            );
        }
        throw txError;
    }

    return NextResponse.json({
        summary,
        keyPoints,
        actionItems,
        provider: credentials.provider,
        model,
    });
});

// GET - Fetch existing summary
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;

    const [enhancement] = await db
        .select()
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!enhancement) {
        return NextResponse.json({ summary: null });
    }

    return NextResponse.json({
        summary: enhancement.summary,
        keyPoints: enhancement.keyPoints,
        actionItems: enhancement.actionItems,
        provider: enhancement.provider,
        model: enhancement.model,
        createdAt: enhancement.createdAt,
    });
});

// DELETE - Remove summary
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;

    await db
        .delete(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        );

    return NextResponse.json({ success: true });
});
