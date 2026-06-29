import { and, eq, isNull } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
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
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { buildAudioFile } from "@/lib/transcription/audio-file";
import { chatTranscribe } from "@/lib/transcription/chat-transcribe";
import { maybeCompressForWhisper } from "@/lib/transcription/compress-audio";
import {
    buildTranscriptionParams,
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";
import { upsertTranscription } from "@/lib/transcription/persist";
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
                    // Only the user's own ('riffado') transcript gates the
                    // idempotent short-circuit and forced re-run. A
                    // Plaud-imported transcript ('plaud') must NOT suppress the
                    // user's own run, and the user's run must NOT overwrite the
                    // Plaud row — the two coexist. See #204.
                    eq(transcriptions.source, "riffado"),
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

        void quality;

        const apiKey = decrypt(credentials.apiKey);

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

        // Route based on the provider's transcription style:
        // - "gemini": Google Gemini native generateContent API (inlineData)
        // - "chat": OpenAI-compatible chat completions with input_audio
        // - "whisper": OpenAI-compatible /v1/audio/transcriptions
        const transcriptionStyle = getTranscriptionStyle(credentials.provider);

        let transcriptionText: string;
        let detectedLanguage: string | null;

        if (transcriptionStyle === "gemini") {
            const result = await geminiTranscribe({
                apiKey,
                model,
                audioBuffer,
                contentType,
                language: defaultLanguage,
            });
            transcriptionText = result.text;
            detectedLanguage = result.detectedLanguage;
        } else {
            const openai = new OpenAI({
                apiKey,
                baseURL: credentials.baseUrl || undefined,
            });

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

                // OpenAI's /v1/audio/transcriptions endpoint has a hard 25 MiB
                // per-request limit (https://platform.openai.com/docs/guides/speech-to-text).
                // For meeting-length recordings that limit is the common case,
                // not the edge case — fall back to a mono Opus re-encode so the
                // 3 h+ uploads users actually have don't get rejected with a 413.
                const compressed = await maybeCompressForWhisper(
                    audioBuffer,
                    contentType,
                );
                const fileToSend = compressed.compressed
                    ? buildAudioFile(
                          compressed.buffer,
                          recording.storagePath,
                          decryptedFilename,
                      ).file
                    : audioFile;

                // Whisper-1 transcribes at roughly 0.1-0.3x realtime on
                // OpenAI's infrastructure, so a 3 h compressed recording can
                // legitimately keep the request open for 20-40 minutes. The
                // SDK default (10 min) times out long before that. Override
                // per-request so unrelated OpenAI calls (e.g. title generation)
                // keep the shorter default.
                const transcription = await openai.audio.transcriptions.create(
                    buildTranscriptionParams({
                        file: fileToSend,
                        model,
                        responseFormat,
                        language: defaultLanguage,
                    }),
                    { timeout: whisperRequestTimeoutMs() },
                );
                const parsed = parseTranscriptionResponse(
                    transcription,
                    responseFormat,
                );
                transcriptionText = parsed.text;
                detectedLanguage = parsed.detectedLanguage;
            }
        }

        // Persist the user's own ('riffado') transcript via the shared,
        // tombstone-aware, source-scoped upsert. The persisted model is the
        // *actual* model used (may differ from the provider default when the
        // manual route supplied an override).
        const { committed } = await upsertTranscription({
            userId,
            recordingId,
            text: transcriptionText,
            detectedLanguage,
            source: "riffado",
            provider: credentials.provider,
            model,
        });

        if (!committed) {
            return {
                success: false,
                error: "Recording was deleted before transcription finished",
                errorCode: "RECORDING_DELETED",
            };
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

const DEFAULT_WHISPER_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

function whisperRequestTimeoutMs(): number {
    const raw = process.env.WHISPER_REQUEST_TIMEOUT_MS;
    if (!raw) return DEFAULT_WHISPER_REQUEST_TIMEOUT_MS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_WHISPER_REQUEST_TIMEOUT_MS;
}
