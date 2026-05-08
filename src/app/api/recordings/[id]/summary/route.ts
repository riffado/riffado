import { and, eq } from "drizzle-orm";
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
import {
    decryptJsonField,
    decryptText,
    encryptJsonField,
    encryptText,
} from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

async function resolveCredentials(userId: string) {
    const [enhancementCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultEnhancement, true),
            ),
        )
        .limit(1);

    const [transcriptionCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultTranscription, true),
            ),
        )
        .limit(1);

    const credentials = enhancementCredentials || transcriptionCredentials;
    if (!credentials) return null;

    const apiKey = decrypt(credentials.apiKey);
    let model = credentials.defaultModel || "gpt-4o-mini";
    if (model.includes("whisper")) {
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

    return { credentials, apiKey, model };
}

async function buildSummaryPrompt(
    userId: string,
    presetId: string | undefined,
): Promise<{ promptTemplate: string; selectedPreset: string }> {
    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
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

    return { promptTemplate, selectedPreset };
}

async function callAiSummary(
    credentials: {
        credentials: typeof apiCredentials.$inferSelect;
        apiKey: string;
        model: string;
    },
    transcriptText: string,
    promptTemplate: string,
    aiOutputLanguage: string | null,
) {
    const openai = new OpenAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.credentials.baseUrl || undefined,
    });

    const maxLength = 8000;
    const truncatedTranscription =
        transcriptText.length > maxLength
            ? `${transcriptText.substring(0, maxLength)}...`
            : transcriptText;

    const languageDirective = getAiOutputLanguageDirective(aiOutputLanguage);
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
        model: credentials.model,
        messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 2000,
    });

    const rawContent = response.choices[0]?.message?.content?.trim() || "";

    let summary = "";
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    try {
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
        summary = rawContent;
    }

    return { summary, keyPoints, actionItems };
}

// POST - Generate or regenerate a summary
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
    const summaryId = (body.summaryId as string) || undefined;

    // Verify recording belongs to user
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(eq(recordings.id, id), eq(recordings.userId, session.user.id)),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    if (recording.deletedAt) {
        throw new AppError(ErrorCode.NOT_FOUND, "Recording was deleted", 410);
    }

    // Get transcription text
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

    const { promptTemplate, selectedPreset } = await buildSummaryPrompt(
        session.user.id,
        presetId,
    );

    const creds = await resolveCredentials(session.user.id);
    if (!creds) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "No AI provider configured",
            400,
        );
    }

    const transcriptText = decryptText(transcription.text);

    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    const { summary, keyPoints, actionItems } = await callAiSummary(
        creds,
        transcriptText,
        promptTemplate,
        userSettingsRow?.aiOutputLanguage ?? null,
    );

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

            const encryptedSummary = encryptText(summary);
            const encryptedKeyPoints = encryptJsonField(keyPoints);
            const encryptedActionItems = encryptJsonField(actionItems);

            if (summaryId) {
                const [existing] = await tx
                    .select()
                    .from(aiEnhancements)
                    .where(
                        and(
                            eq(aiEnhancements.id, summaryId),
                            eq(aiEnhancements.recordingId, id),
                            eq(aiEnhancements.userId, session.user.id),
                        ),
                    )
                    .limit(1);

                if (!existing) {
                    throw new AppError(
                        ErrorCode.NOT_FOUND,
                        "Summary not found",
                        404,
                    );
                }

                await tx
                    .update(aiEnhancements)
                    .set({
                        summary: encryptedSummary,
                        keyPoints: encryptedKeyPoints,
                        actionItems: encryptedActionItems,
                        provider: creds.credentials.provider,
                        model: creds.model,
                        presetId: selectedPreset,
                    })
                    .where(eq(aiEnhancements.id, existing.id));
            } else {
                await tx.insert(aiEnhancements).values({
                    recordingId: id,
                    userId: session.user.id,
                    summary: encryptedSummary,
                    keyPoints: encryptedKeyPoints,
                    actionItems: encryptedActionItems,
                    provider: creds.credentials.provider,
                    model: creds.model,
                    presetId: selectedPreset,
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
        provider: creds.credentials.provider,
        model: creds.model,
        presetId: selectedPreset,
    });
});

// GET - Fetch all summaries for a recording
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;

    const enhancements = await db
        .select()
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        )
        .orderBy(aiEnhancements.createdAt);

    const summaries = enhancements.map((e) => ({
        id: e.id,
        summary: decryptText(e.summary),
        keyPoints: decryptJsonField<string[]>(e.keyPoints),
        actionItems: decryptJsonField<string[]>(e.actionItems),
        provider: e.provider,
        model: e.model,
        presetId: e.presetId,
        createdAt: e.createdAt,
    }));

    return NextResponse.json({ summaries });
});

// DELETE - Remove a specific summary by id
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;
    const { searchParams } = new URL(request.url);
    const summaryId = searchParams.get("summaryId");

    if (!summaryId) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "summaryId query parameter is required",
            400,
        );
    }

    await db
        .delete(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.id, summaryId),
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        );

    return NextResponse.json({ success: true });
});
