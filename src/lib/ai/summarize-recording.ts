import { and, eq, isNull } from "drizzle-orm";
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
import { decrypt } from "@/lib/encryption";
import {
    decryptJsonField,
    decryptText,
    encryptJsonField,
    encryptText,
} from "@/lib/encryption/fields";
import { emitEvent } from "@/lib/webhooks/emit";

/**
 * Shared summary worker — used by both the `POST /api/recordings/[id]/summary`
 * route (manual button) and the `transcribeRecording` worker
 * (auto-summary after transcript). Lifted out of the route handler so
 * the same code path runs in both contexts without HTTP-fetching the
 * app from itself.
 */

export type SummarizeErrorCode =
    | "RECORDING_NOT_FOUND"
    | "RECORDING_DELETED"
    | "NO_TRANSCRIPTION"
    | "NO_AI_PROVIDER"
    | "PROMPT_NOT_FOUND";

export interface SummarizeResult {
    success: boolean;
    error?: string;
    errorCode?: SummarizeErrorCode;
    summary?: string;
    keyPoints?: string[];
    actionItems?: string[];
    provider?: string;
    model?: string;
}

export interface SummarizeOptions {
    /** Override the user's default preset (e.g. "meeting-notes"). */
    presetId?: string;
}

const TRANSCRIPT_MAX_CHARS = 8000;

export async function summarizeRecording(
    userId: string,
    recordingId: string,
    opts: SummarizeOptions = {},
): Promise<SummarizeResult> {
    try {
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return {
                success: false,
                error: "Recording not found",
                errorCode: "RECORDING_NOT_FOUND",
            };
        }

        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recordingId),
                    eq(transcriptions.userId, userId),
                ),
            )
            .limit(1);

        if (!transcription) {
            return {
                success: false,
                error: "No transcription available",
                errorCode: "NO_TRANSCRIPTION",
            };
        }

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

        const selectedPreset =
            opts.presetId || promptConfig.selectedPrompt || "general";
        let promptTemplate = getSummaryPromptById(
            selectedPreset,
            promptConfig,
        );
        if (!promptTemplate) {
            const defaultConfig = getDefaultSummaryPromptConfig();
            promptTemplate = getSummaryPromptById(
                defaultConfig.selectedPrompt,
                defaultConfig,
            );
            if (!promptTemplate) {
                return {
                    success: false,
                    error: "Failed to load summary prompt",
                    errorCode: "PROMPT_NOT_FOUND",
                };
            }
        }

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

        if (!credentials) {
            return {
                success: false,
                error: "No AI provider configured",
                errorCode: "NO_AI_PROVIDER",
            };
        }

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Use a chat model, not whisper. If the configured model is a
        // transcription-only model (e.g. user's default is whisper-1
        // because they only set up the transcription credential), fall
        // back to a sensible chat model for the provider.
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

        const transcriptText = decryptText(transcription.text);
        const truncatedTranscription =
            transcriptText.length > TRANSCRIPT_MAX_CHARS
                ? `${transcriptText.substring(0, TRANSCRIPT_MAX_CHARS)}...`
                : transcriptText;

        const languageDirective = getAiOutputLanguageDirective(
            userSettingsRow?.aiOutputLanguage ?? null,
            transcription.detectedLanguage,
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
                { role: "system", content: systemContent },
                { role: "user", content: prompt },
            ],
            temperature: 0.5,
            max_tokens: 2000,
        });

        const rawContent =
            response.choices[0]?.message?.content?.trim() || "";

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
            keyPoints = Array.isArray(parsed.keyPoints)
                ? parsed.keyPoints
                : [];
            actionItems = Array.isArray(parsed.actionItems)
                ? parsed.actionItems
                : [];
        } catch {
            summary = rawContent;
        }

        // Atomic tombstone re-check + upsert (mirrors the route's
        // original transaction). Without this, a DELETE that lands
        // between our recording lookup and our upsert would silently
        // resurrect the row. DELETE's tx takes the same FOR UPDATE
        // lock on `recordings`, so the two serialize.
        const RECORDING_TOMBSTONED = Symbol("recording-tombstoned");
        try {
            await db.transaction(async (tx) => {
                const [stillActive] = await tx
                    .select({ deletedAt: recordings.deletedAt })
                    .from(recordings)
                    .where(
                        and(
                            eq(recordings.id, recordingId),
                            eq(recordings.userId, userId),
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
                            eq(aiEnhancements.recordingId, recordingId),
                            eq(aiEnhancements.userId, userId),
                        ),
                    )
                    .limit(1);

                const encryptedSummary = encryptText(summary);
                const encryptedKeyPoints = encryptJsonField(keyPoints);
                const encryptedActionItems = encryptJsonField(actionItems);

                if (existing) {
                    await tx
                        .update(aiEnhancements)
                        .set({
                            summary: encryptedSummary,
                            keyPoints: encryptedKeyPoints,
                            actionItems: encryptedActionItems,
                            provider: credentials.provider,
                            model,
                        })
                        .where(
                            and(
                                eq(aiEnhancements.id, existing.id),
                                eq(aiEnhancements.userId, userId),
                            ),
                        );
                } else {
                    await tx.insert(aiEnhancements).values({
                        recordingId,
                        userId,
                        summary: encryptedSummary,
                        keyPoints: encryptedKeyPoints,
                        actionItems: encryptedActionItems,
                        provider: credentials.provider,
                        model,
                    });
                }

                await tx
                    .update(recordings)
                    .set({ updatedAt: new Date() })
                    .where(
                        and(
                            eq(recordings.id, recordingId),
                            eq(recordings.userId, userId),
                            isNull(recordings.deletedAt),
                        ),
                    );
            });
        } catch (txError) {
            if (txError === RECORDING_TOMBSTONED) {
                return {
                    success: false,
                    error: "Recording was deleted",
                    errorCode: "RECORDING_DELETED",
                };
            }
            throw txError;
        }

        await emitEvent("summary.created", userId, recordingId);

        return {
            success: true,
            summary,
            keyPoints,
            actionItems,
            provider: credentials.provider,
            model,
        };
    } catch (error) {
        console.error("summarizeRecording failed:", error);
        await emitEvent("summary.failed", userId, recordingId, {
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Summary generation failed",
        };
    }
}
