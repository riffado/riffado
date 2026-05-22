import { and, eq, isNull } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    aiEnhancements,
    apiCredentials,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { getTranscriptionStyle } from "@/lib/ai/provider-presets";
import { decrypt } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { consumeRateLimitBucket } from "@/lib/rate-limit";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";
import { buildAudioFile } from "@/lib/transcription/audio-file";
import { chatTranscribe } from "@/lib/transcription/chat-transcribe";
import {
    buildTranscriptionParams,
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { emitEvent } from "@/lib/webhooks/emit";

/**
 * Discriminator for typed error handling at the route boundary. Internal
 * sync callers can ignore it; the manual
 * `/api/recordings/[id]/transcribe` route maps these to HTTP status codes.
 */
export type TranscribeErrorCode =
    | "RECORDING_NOT_FOUND"
    | "NO_TRANSCRIPTION_PROVIDER"
    | "RECORDING_DELETED"
    | "TRANSCRIPTION_FAILED";

export interface TranscribeOptions {
    /** Use a specific provider (by id, user-scoped) instead of the user's default. */
    providerId?: string;
    /** Override the provider's default model for this single call. */
    model?: string;
    /**
     * Re-run the provider call even when a transcript already exists.
     * Used by the manual "Re-transcribe" button so a user clicking it
     * with an override (or just wanting a fresh result) actually re-hits
     * the API and overwrites the stored transcript. The sync worker
     * leaves this `false` so duplicate post-sync auto-transcribes remain
     * idempotent.
     */
    force?: boolean;
}

export interface TranscribeResult {
    success: boolean;
    error?: string;
    errorCode?: TranscribeErrorCode;
    /** Present on success. Plaintext transcript. */
    text?: string;
    /** Present on success when the provider returned a language. */
    detectedLanguage?: string | null;
}

export async function transcribeRecording(
    userId: string,
    recordingId: string,
    opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
    try {
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                    // Skip tombstoned recordings. Without this filter the
                    // post-sync auto-transcribe path would happily upload the
                    // audio for a recording the user just deleted, recreate
                    // its transcription row, and (if syncTitleToPlaud is on)
                    // even push a generated title back to Plaud. See PR #72.
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

        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recordingId),
                    eq(transcriptions.userId, userId),
                ),
            )
            .limit(1);

        if (existingTranscription?.text && !opts.force) {
            // Idempotent short-circuit: a prior run already produced a
            // transcript and the caller hasn't asked for a forced re-run.
            // The sync worker relies on this so duplicate post-sync
            // auto-transcribes are no-ops. The manual "Re-transcribe"
            // route passes `force: true` to bypass it (so provider/model
            // overrides actually take effect).
            return {
                success: true,
                text: decryptText(existingTranscription.text),
                detectedLanguage: existingTranscription.detectedLanguage,
            };
        }

        // Provider selection: explicit `providerId` (manual override
        // from the route, user-scoped lookup by id) takes precedence
        // over the user's default transcription provider.
        const [credentials] = opts.providerId
            ? await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.id, opts.providerId),
                          eq(apiCredentials.userId, userId),
                      ),
                  )
                  .limit(1)
            : await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.userId, userId),
                          eq(apiCredentials.isDefaultTranscription, true),
                      ),
                  )
                  .limit(1);

        if (!credentials) {
            return {
                success: false,
                error: "No transcription API configured",
                errorCode: "NO_TRANSCRIPTION_PROVIDER",
            };
        }

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const defaultLanguage =
            settings?.defaultTranscriptionLanguage || undefined;
        const quality = settings?.transcriptionQuality || "balanced";
        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;
        const autoSummarize = settings?.autoSummarize ?? false;
        const autoSummarizePreset = settings?.autoSummarizePreset ?? null;

        void quality;

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // `recording.filename` is encrypted at rest; decrypt before passing
        // to the transcription provider as a filename hint.
        const decryptedFilename = decryptText(recording.filename);
        const { file: audioFile, contentType } = buildAudioFile(
            audioBuffer,
            recording.storagePath,
            decryptedFilename,
        );

        const model = opts.model || credentials.defaultModel || "whisper-1";

        // Chat-style providers (OpenRouter today) don't implement
        // `/v1/audio/transcriptions` — calling that path returns a 404
        // with a non-JSON body that crashes the OpenAI SDK's response
        // parser (issue #122). Route those through chat-completions
        // with an `input_audio` content part instead.
        const transcriptionStyle = getTranscriptionStyle(credentials.provider);

        let transcriptionText: string;
        let detectedLanguage: string | null;

        if (transcriptionStyle === "chat") {
            const result = await chatTranscribe({
                client: openai,
                model,
                audioBuffer,
                contentType,
                language: defaultLanguage,
            });
            transcriptionText = result.text;
            detectedLanguage = result.detectedLanguage;
        } else {
            const responseFormat = getResponseFormat(model);
            const transcription = await openai.audio.transcriptions.create(
                buildTranscriptionParams({
                    file: audioFile,
                    model,
                    responseFormat,
                    language: defaultLanguage,
                }),
            );
            const parsed = parseTranscriptionResponse(
                transcription,
                responseFormat,
            );
            transcriptionText = parsed.text;
            detectedLanguage = parsed.detectedLanguage;
        }

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

                const [currentTranscription] = await tx
                    .select()
                    .from(transcriptions)
                    .where(
                        and(
                            eq(transcriptions.recordingId, recordingId),
                            eq(transcriptions.userId, userId),
                        ),
                    )
                    .limit(1);

                const encryptedTranscriptionText =
                    encryptText(transcriptionText);

                // Persist the *actual* model used (which may differ from
                // the provider default when the manual route supplied an
                // override). Mirrors what the OpenAI request really ran.
                if (currentTranscription) {
                    // Re-transcribe path: the previous transcript is being
                    // overwritten, so any existing summary now references
                    // stale source text. Drop it inside the same tx so
                    // readers never see "fresh transcript + old summary".
                    // If auto-summarize is on, a fresh summary will be
                    // generated below; otherwise the recording shows no
                    // summary until the user clicks "Generate summary".
                    await tx
                        .delete(aiEnhancements)
                        .where(
                            and(
                                eq(aiEnhancements.recordingId, recordingId),
                                eq(aiEnhancements.userId, userId),
                            ),
                        );

                    await tx
                        .update(transcriptions)
                        .set({
                            text: encryptedTranscriptionText,
                            detectedLanguage,
                            transcriptionType: "server",
                            provider: credentials.provider,
                            model,
                        })
                        .where(
                            and(
                                eq(transcriptions.id, currentTranscription.id),
                                eq(transcriptions.userId, userId),
                            ),
                        );
                } else {
                    await tx.insert(transcriptions).values({
                        recordingId,
                        userId,
                        text: encryptedTranscriptionText,
                        detectedLanguage,
                        transcriptionType: "server",
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
                    error: "Recording was deleted before transcription finished",
                    errorCode: "RECORDING_DELETED",
                };
            }
            throw txError;
        }

        if (autoGenerateTitle && transcriptionText.trim()) {
            try {
                const generatedTitle = await generateTitleFromTranscription(
                    userId,
                    transcriptionText,
                );

                if (generatedTitle) {
                    // Encrypt the generated title before storing it as the
                    // recording's filename. The plaintext is still available
                    // below for the optional sync-to-Plaud push.
                    await db
                        .update(recordings)
                        .set({
                            filename: encryptText(generatedTitle),
                            updatedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(recordings.id, recordingId),
                                eq(recordings.userId, userId),
                                isNull(recordings.deletedAt),
                            ),
                        );

                    if (syncTitleToPlaud) {
                        try {
                            const [connection] = await db
                                .select()
                                .from(plaudConnections)
                                .where(eq(plaudConnections.userId, userId))
                                .limit(1);

                            if (connection) {
                                const plaudClient = await createPlaudClient(
                                    connection.bearerToken,
                                    connection.apiBase,
                                    connection.workspaceId,
                                );
                                await plaudClient.updateFilename(
                                    recording.plaudFileId,
                                    generatedTitle,
                                );
                                // Backfill workspaceId if newly resolved.
                                // Always scope user-owned UPDATEs by userId
                                // even when filtering by id (per AGENTS.md).
                                const resolved = plaudClient.workspaceId;
                                if (
                                    resolved &&
                                    resolved !== connection.workspaceId
                                ) {
                                    await db
                                        .update(plaudConnections)
                                        .set({ workspaceId: resolved })
                                        .where(
                                            and(
                                                eq(
                                                    plaudConnections.id,
                                                    connection.id,
                                                ),
                                                eq(
                                                    plaudConnections.userId,
                                                    userId,
                                                ),
                                            ),
                                        );
                                }
                            }
                        } catch (error) {
                            console.error(
                                "Failed to sync title to Plaud:",
                                error,
                            );
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to generate title:", error);
            }
        }

        await emitEvent("transcription.completed", userId, recordingId);

        if (autoSummarize) {
            // Per-user hourly cap on auto-summary calls. Cheap defense
            // against runaway provider cost if a sync replays N
            // recordings or the user toggles auto-summarize on with an
            // expensive model. The manual "Generate summary" button is
            // not throttled — the user is in the loop there.
            const rateLimit = await consumeRateLimitBucket(
                `auto-summary:user:${userId}`,
                {
                    limit: env.AUTO_SUMMARY_RATE_LIMIT_PER_HOUR,
                    windowMs: 60 * 60 * 1000,
                },
            );

            if (!rateLimit.allowed) {
                console.warn(
                    `Auto-summary rate limit hit for user ${userId} (recording ${recordingId})`,
                );
                await emitEvent("summary.failed", userId, recordingId, {
                    error: `Auto-summary rate limit exceeded (${env.AUTO_SUMMARY_RATE_LIMIT_PER_HOUR}/hour). Manual summary still works.`,
                });
            } else {
                // Run summarization synchronously so the `summary.completed`
                // event (and the underlying `aiEnhancements` write) lands
                // before downstream consumers that listen for it. A failure
                // here must not roll back the transcript itself — the user
                // still wants the transcript even if the summary call dies.
                try {
                    await generateSummaryForRecording(userId, recordingId, {
                        presetId: autoSummarizePreset ?? undefined,
                    });
                    await emitEvent("summary.completed", userId, recordingId);
                } catch (error) {
                    console.error(
                        `Auto-summarize failed for recording ${recordingId}:`,
                        error,
                    );
                    await emitEvent("summary.failed", userId, recordingId, {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            }
        }

        return {
            success: true,
            text: transcriptionText,
            detectedLanguage,
        };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        await emitEvent("transcription.failed", userId, recordingId, {
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
            errorCode: "TRANSCRIPTION_FAILED",
        };
    }
}
