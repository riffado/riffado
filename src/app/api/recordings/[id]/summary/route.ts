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
import { buildChatCompletionParams } from "@/lib/ai/chat-completion-params";
import {
    getAiOutputLanguageDirective,
    getDefaultSummaryPromptConfig,
    getSummaryPromptById,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { requireApiSession } from "@/lib/auth-server";
import { DEMO_SUMMARIES, isDemoRecordingId } from "@/lib/demo/fixtures";
import { decrypt } from "@/lib/encryption";
import { decryptJsonField, decryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { upsertEnhancement } from "@/lib/transcription/persist";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));
    const presetId = (body.preset as string) || undefined;

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

    // NOTE: when both a Plaud-imported and the user's own transcript coexist,
    // this currently summarizes whichever the DB returns first. Selecting the
    // user's *active* transcript is handled in the Phase 5 UI work (#204).
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, id),
                eq(transcriptions.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!transcription) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "No transcription available. Transcribe the recording first.",
            400,
        );
    }

    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    let promptConfig: SummaryPromptConfiguration =
        getDefaultSummaryPromptConfig();
    if (userSettingsRow?.summaryPrompt) {
        const config =
            decryptJsonField<SummaryPromptConfiguration>(
                userSettingsRow.summaryPrompt,
            ) ?? getDefaultSummaryPromptConfig();
        promptConfig = {
            selectedPrompt: config.selectedPrompt || "general",
            customPrompts: config.customPrompts || [],
        };
    }

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

    // Decrypt the transcript before sending it to the LLM. Plaintext is
    // the LLM's input contract; ciphertext lives only in the DB.
    const transcriptText = decryptText(transcription.text);

    // Apply AI output language directive (if configured) via the system
    // message rather than the user prompt. This separates concerns: the
    // user prompt carries the JSON-shape contract (English keys), the
    // system message carries the output-language preference. Smaller
    // models tend to honor this split more reliably than a combined
    // prompt where language and JSON-shape rules compete.
    const languageDirective = getAiOutputLanguageDirective(
        userSettingsRow?.aiOutputLanguage ?? null,
    );

    // Use a replacement function so `$` sequences in the transcript (e.g.
    // `$1`, `$&`, `$$`) are inserted verbatim instead of being interpreted
    // as `String.prototype.replace` special patterns.
    const prompt = promptTemplate.replace(
        "{transcription}",
        () => transcriptText,
    );

    const baseSystem =
        "You are a helpful assistant that summarizes audio transcriptions. Always respond with valid JSON only, no markdown formatting or code fences.";
    const systemContent = languageDirective
        ? `${baseSystem} ${languageDirective}`
        : baseSystem;

    const response = await openai.chat.completions.create(
        buildChatCompletionParams({
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
            maxTokens: 2000,
        }),
    );

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

    // Persist the riffado-generated summary via the shared, tombstone-aware
    // upsert. Summaries stay single per recording; `source` records the origin.
    const { committed } = await upsertEnhancement({
        userId: session.user.id,
        recordingId: id,
        summary,
        keyPoints,
        actionItems,
        source: "riffado",
        provider: credentials.provider,
        model,
    });

    if (!committed) {
        throw new AppError(ErrorCode.NOT_FOUND, "Recording was deleted", 410);
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
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    // Dev-only short-circuit for the `/dev/demo-dashboard` screenshot
    // route. Two gates -- `NODE_ENV !== production` AND a `demo-` id
    // prefix -- so this branch is literally unreachable in production
    // builds even if a caller invents a `demo-*` id. Never touches the
    // DB, never decrypts, never logs PII. See `src/lib/demo/fixtures.ts`.
    if (process.env.NODE_ENV !== "production" && isDemoRecordingId(id)) {
        const fixture = DEMO_SUMMARIES.get(id);
        if (!fixture) {
            return NextResponse.json({ summary: null });
        }
        return NextResponse.json({
            summary: fixture.summary,
            keyPoints: fixture.keyPoints,
            actionItems: fixture.actionItems,
            provider: fixture.provider,
            model: fixture.model,
        });
    }

    const [recording] = await db
        .select({ id: recordings.id })
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

    // Decrypt content fields before returning to the client. Legacy
    // plaintext rows pass through verbatim during the backfill window.
    return NextResponse.json({
        summary: decryptText(enhancement.summary),
        keyPoints: decryptJsonField<string[]>(enhancement.keyPoints),
        actionItems: decryptJsonField<string[]>(enhancement.actionItems),
        provider: enhancement.provider,
        model: enhancement.model,
        createdAt: enhancement.createdAt,
    });
});

// DELETE - Remove summary
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    await db.transaction(async (tx) => {
        const deleted = await tx
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            )
            .returning({ id: aiEnhancements.id });

        if (deleted.length > 0) {
            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                        isNull(recordings.deletedAt),
                    ),
                );
        }
    });

    return NextResponse.json({ success: true });
});
