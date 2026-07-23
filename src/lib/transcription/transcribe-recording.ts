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
import { isHostedLockedOut } from "@/lib/entitlements";
import { env } from "@/lib/env";
import {
    isMynahConfigured,
    transcribeViaMynah,
} from "@/lib/hosted/transcription/mynah";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import {
    captureServerEvent,
    captureServerException,
} from "@/lib/posthog-server";
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
import { isRiffadoIncludedProviderId } from "@/lib/transcription/included-provider";
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
    | "HOSTED_LOCKED_OUT"
    | "MYNAH_BUDGET_EXHAUSTED"
    | "TRANSCRIPTION_FAILED";

export interface StoreBrowserTranscriptionInput {
    userId: string;
    recordingId: string;
    text: string;
    detectedLanguage: string | null;
    model: string;
}

/**
 * Persist a transcription produced in the browser by Transformers.js.
 *
 * Mirrors the persistence half of `transcribeRecording` (tombstone check,
 * at-rest encryption, upsert, `transcription.completed` event) but skips
 * the server-side provider call. Auto-generated title and Plaud title
 * sync are intentionally NOT run from this path; browser-only users
 * typically have no AI provider configured and the title generation
 * would silently fail. If a browser-transcribing user later wants a
 * generated title they can trigger it once they configure an AI key.
 */
export async function storeBrowserTranscription(
    input: StoreBrowserTranscriptionInput,
): Promise<TranscribeResult> {
    const { userId, recordingId, text, detectedLanguage, model } = input;

    // Hosted lockout: a lapsed account is read-only, even for the
    // zero-cost browser path. No-op on self-host.
    if (await isHostedLockedOut(userId)) {
        await captureServerEvent({
            distinctId: userId,
            event: "hosted_locked_out_attempt",
            properties: { trigger: "browser" },
        });
        return {
            success: false,
            error: "Your hosted plan has lapsed. Subscribe to resume transcription.",
            errorCode: "HOSTED_LOCKED_OUT",
        };
    }

    const [recording] = await db
        .select({ id: recordings.id, deletedAt: recordings.deletedAt })
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
                .select({ id: transcriptions.id })
                .from(transcriptions)
                .where(
                    and(
                        eq(transcriptions.recordingId, recordingId),
                        eq(transcriptions.userId, userId),
                    ),
                )
                .limit(1);

            const encryptedText = encryptText(text);
            if (existing) {
                await tx
                    .update(transcriptions)
                    .set({
                        text: encryptedText,
                        detectedLanguage,
                        transcriptionType: "browser",
                        provider: "browser",
                        model,
                    })
                    .where(
                        and(
                            eq(transcriptions.id, existing.id),
                            eq(transcriptions.userId, userId),
                        ),
                    );
            } else {
                await tx.insert(transcriptions).values({
                    recordingId,
                    userId,
                    text: encryptedText,
                    detectedLanguage,
                    transcriptionType: "browser",
                    provider: "browser",
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

    await emitEvent("transcription.completed", userId, recordingId);
    await captureServerEvent({
        distinctId: userId,
        event: "recording_transcribed",
        properties: { trigger: "browser", provider_type: "browser" },
    });
    return { success: true, text, detectedLanguage };
}

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
    /** What triggered this call. Drives the `recording_transcribed` event's `trigger` property. */
    trigger?: "manual" | "sync";
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

/**
 * Per-recording in-flight tracker. Two paths can race to transcribe the
 * same recording at the same moment:
 *
 *   1. The manual `POST /api/recordings/[id]/transcribe` route fires on
 *      every Retry click; an impatient user clicking twice fans out two
 *      concurrent provider calls.
 *   2. The post-sync auto-transcribe path (`queueTranscriptions`) for new
 *      recordings can land mid-Retry-click.
 *
 * Both pay the full provider latency (a 90-min recording through a
 * diarize+ASR proxy can take ~9 min), and the later call serializes
 * behind any backend lock. On a provider with a hard request timeout
 * (OpenAI SDK defaults to 10 min) the queued call can blow past the
 * cliff and fail even though the first call would have succeeded.
 *
 * The tracker collapses concurrent calls for the same recording into a
 * single shared promise, mirroring the `inFlightSyncs` pattern in
 * `sync-recordings.ts`. The first caller wins; subsequent callers share
 * its result (and its `force`/`providerId`/`model` decisions). This is
 * deliberate: if a caller wants a *different* run after the in-flight
 * one completes, they call again — the map will be empty by then.
 */
const inFlightTranscriptions = new Map<string, Promise<TranscribeResult>>();

export async function transcribeRecording(
    userId: string,
    recordingId: string,
    opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
    const key = `${userId}:${recordingId}`;
    const inFlight = inFlightTranscriptions.get(key);
    if (inFlight) {
        return inFlight;
    }
    const work = transcribeRecordingInner(userId, recordingId, opts);
    inFlightTranscriptions.set(key, work);
    try {
        return await work;
    } finally {
        inFlightTranscriptions.delete(key);
    }
}

async function transcribeRecordingInner(
    userId: string,
    recordingId: string,
    opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
    try {
        // Hosted lockout: a lapsed account is read-only. No-op on
        // self-host (isHostedLockedOut always false there).
        if (await isHostedLockedOut(userId)) {
            await captureServerEvent({
                distinctId: userId,
                event: "hosted_locked_out_attempt",
                properties: { trigger: opts.trigger ?? "manual" },
            });
            return {
                success: false,
                error: "Your hosted plan has lapsed. Subscribe to resume transcription.",
                errorCode: "HOSTED_LOCKED_OUT",
            };
        }

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

        const [legacyDefaultCredentials] = opts.providerId
            ? []
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
        const pointer = settings?.defaultTranscriptionProviderId ?? null;
        const requested = opts.providerId || pointer || null;
        const useManaged = isRiffadoIncludedProviderId(requested);

        void quality;

        let credentials: typeof apiCredentials.$inferSelect | undefined;
        if (!useManaged && requested) {
            [credentials] = await db
                .select()
                .from(apiCredentials)
                .where(
                    and(
                        eq(apiCredentials.id, requested),
                        eq(apiCredentials.userId, userId),
                    ),
                )
                .limit(1);
        } else if (!useManaged) {
            credentials = legacyDefaultCredentials;
        }

        const runManagedTranscription = async () => {
            const input = {
                userId,
                storagePath: recording.storagePath,
                durationMs: recording.duration,
                language: defaultLanguage,
                filename: decryptText(recording.filename),
            };
            const result = await transcribeViaMynah(input);
            return {
                text: result.text,
                detectedLanguage: result.detectedLanguage,
                provider: "mynah",
                model: "parakeet",
            };
        };

        let transcriptionText: string;
        let detectedLanguage: string | null;
        let persistProvider: string;
        let persistModel: string;

        if (useManaged) {
            if (!isMynahConfigured()) {
                return {
                    success: false,
                    error: "No transcription API configured",
                    errorCode: "NO_TRANSCRIPTION_PROVIDER",
                };
            }
            const result = await runManagedTranscription();
            transcriptionText = result.text;
            detectedLanguage = result.detectedLanguage;
            persistProvider = result.provider;
            persistModel = result.model;
        } else if (credentials) {
            const apiKey = decrypt(credentials.apiKey);

            const storage = await createUserStorageProvider(userId);
            const audioBuffer = await storage.downloadFile(
                recording.storagePath,
            );

            // `recording.filename` is encrypted at rest; decrypt before
            // passing to the transcription provider as a filename hint.
            const decryptedFilename = decryptText(recording.filename);
            const { file: audioFile, contentType } = buildAudioFile(
                audioBuffer,
                recording.storagePath,
                decryptedFilename,
            );

            const model = opts.model || credentials.defaultModel || "whisper-1";
            persistProvider = credentials.provider;
            persistModel = model;

            // Route based on the provider's transcription style:
            // - "gemini": Google Gemini native generateContent API (inlineData)
            // - "chat": OpenAI-compatible chat completions with input_audio
            //   (OpenRouter today; #122 -- /v1/audio/transcriptions 404s there)
            // - "whisper": OpenAI-compatible /v1/audio/transcriptions
            const transcriptionStyle = getTranscriptionStyle(
                credentials.provider,
            );

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

                    // OpenAI's /v1/audio/transcriptions endpoint has a hard
                    // 25 MiB per-request limit. For meeting-length recordings
                    // that limit is the common case, not the edge case -- fall
                    // back to a mono Opus re-encode so 3 h+ uploads don't get
                    // rejected with a 413.
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

                    // Whisper-1 runs ~0.1-0.3x realtime, so a 3 h recording
                    // can keep the request open 20-40 min. The SDK default
                    // (10 min) times out long before that; override
                    // per-request so other OpenAI calls keep the default.
                    const transcription =
                        await openai.audio.transcriptions.create(
                            buildTranscriptionParams({
                                file: fileToSend,
                                model,
                                responseFormat,
                                language: defaultLanguage,
                            }),
                            { timeout: env.WHISPER_REQUEST_TIMEOUT_MS },
                        );
                    const parsed = parseTranscriptionResponse(
                        transcription,
                        responseFormat,
                    );
                    transcriptionText = parsed.text;
                    detectedLanguage = parsed.detectedLanguage;
                }
            }
        } else {
            if (requested || !isMynahConfigured()) {
                return {
                    success: false,
                    error: "No transcription API configured",
                    errorCode: "NO_TRANSCRIPTION_PROVIDER",
                };
            }
            const result = await runManagedTranscription();
            transcriptionText = result.text;
            detectedLanguage = result.detectedLanguage;
            persistProvider = result.provider;
            persistModel = result.model;
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
            provider: persistProvider,
            model: persistModel,
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
        await captureServerEvent({
            distinctId: userId,
            event: "recording_transcribed",
            properties: {
                trigger: opts.trigger ?? "manual",
                provider_type:
                    persistProvider === "mynah" ? "mynah" : "own_key",
                detected_language: detectedLanguage ?? null,
            },
        });

        return {
            success: true,
            text: transcriptionText,
            detectedLanguage,
        };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        if (isMynahBudgetExhausted(error)) {
            await emitEvent("transcription.failed", userId, recordingId, {
                error: "included_transcription_budget_exhausted",
            });
            await captureServerEvent({
                distinctId: userId,
                event: "mynah_budget_exhausted",
                properties: { trigger: opts.trigger ?? "manual" },
            });
            return {
                success: false,
                error: "You've used all of your included Mynah transcription for this cycle. It resets next cycle, or add your own AI provider to keep transcribing.",
                errorCode: "MYNAH_BUDGET_EXHAUSTED",
            };
        }
        captureServerException(error, {
            source: "transcription",
            distinctId: userId,
            trigger: opts.trigger ?? "manual",
        });
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

function isMynahBudgetExhausted(error: unknown): boolean {
    return error instanceof Error && error.name === "MynahBudgetExhaustedError";
}
