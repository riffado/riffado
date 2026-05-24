import { and, eq, isNull, lt, or } from "drizzle-orm";
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
import { summarizeRecording } from "@/lib/ai/summarize-recording";
import { decrypt } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { buildAudioFile } from "@/lib/transcription/audio-file";
import { chatTranscribe } from "@/lib/transcription/chat-transcribe";
import {
    buildTranscriptionParams,
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { streamTranscribe } from "@/lib/transcription/stream-transcribe";
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
    | "TRANSCRIPTION_IN_PROGRESS"
    | "TRANSCRIPTION_FAILED";

/**
 * A transcription claim older than this is treated as stale (a crashed
 * worker, a killed container, a deploy that interrupted a run) and the
 * next caller is allowed to overwrite it. Set generously enough to cover
 * the realistic upper bound of a long-meeting transcribe on a slow
 * CPU-only Whisper box — large-v3 INT8 on a modest VPS can run ~0.5×
 * realtime, so a 60-minute meeting takes ~2h. 3h gives margin without
 * leaving genuinely stuck rows blocked for the rest of the day.
 */
const TRANSCRIPTION_STALE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

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
    // Tracks whether THIS invocation owns the in-flight claim, so the
    // finally block knows whether to clear it. Stays null if we returned
    // before claiming (recording not found, existing-transcript
    // short-circuit, lost the claim race). `claimedAt` is captured at
    // claim time and used in the release WHERE clause as an ownership
    // token: if another worker has since taken over via the stale-claim
    // path, its `transcribing_started_at` will differ and our release
    // becomes a no-op — without this guard a stalled worker that
    // finally returns could clear the live successor's claim and let
    // a third worker race in.
    let claimedRecordingId: string | null = null;
    let claimedAt: Date | null = null;
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

        // Atomic claim — only one worker can be in-flight for a given
        // (user_id, recording_id) at a time. Placed AFTER the provider
        // check so a recording with no configured provider is not
        // briefly marked "in progress" only to be released milliseconds
        // later; the UI would otherwise flicker through a spurious chip
        // state. The UPDATE matches only when the previous claim is
        // null or older than the stale timeout, so two concurrent
        // callers can't both pass: postgres serializes the writes, the
        // loser's UPDATE returns zero rows and surfaces
        // TRANSCRIPTION_IN_PROGRESS (HTTP 409 from the manual route).
        // Without this, rage-clicking "Transcribe" spawned N parallel
        // workers all racing to write the same transcript and burning
        // N× CPU on the provider.
        const claimNow = new Date();
        const staleCutoff = new Date(
            claimNow.getTime() - TRANSCRIPTION_STALE_TIMEOUT_MS,
        );
        const claimed = await db
            .update(recordings)
            .set({
                transcribingStartedAt: claimNow,
                // Reset progress for THIS run — a prior run on the
                // same recording (manual re-transcribe, or a stale
                // takeover) may have left the column populated.
                transcriptionProgressSeconds: null,
            })
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                    or(
                        isNull(recordings.transcribingStartedAt),
                        lt(recordings.transcribingStartedAt, staleCutoff),
                    ),
                ),
            )
            .returning({ id: recordings.id });

        if (claimed.length === 0) {
            return {
                success: false,
                error: "A transcription run is already in progress for this recording",
                errorCode: "TRANSCRIPTION_IN_PROGRESS",
            };
        }
        claimedRecordingId = recordingId;
        claimedAt = claimNow;

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
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Decrypt the caller-supplied context, if any. Whisper's
        // `prompt` field has a hard ~244-token budget upstream; longer
        // primers are silently truncated. ~900 characters is a safe
        // proxy in mixed-script text. The full context (untruncated)
        // is reused later by the summary worker — we only trim for the
        // acoustic-priming pass.
        const recordingContext = recording.context
            ? decryptText(recording.context)
            : null;
        const whisperPrompt = recordingContext
            ? recordingContext.slice(0, 900)
            : undefined;

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
            // Stream only for `verbose_json` providers (whisper-1,
            // Systran/faster-whisper-*, etc.) — those are the ones
            // that emit per-segment events that we can turn into a
            // real progress bar. `diarized_json` (gpt-4o-transcribe-diarize)
            // and the bare `json` shape (gpt-4o-transcribe non-diarize)
            // both need their own response parsing and don't benefit
            // from streaming the same way — keep them on the original
            // non-streaming SDK path so we don't regress #101 / #122.
            const responseFormat = getResponseFormat(model);
            if (responseFormat === "verbose_json") {
                const result = await streamTranscribe({
                    baseUrl: credentials.baseUrl || "https://api.openai.com/v1",
                    apiKey,
                    model,
                    language: defaultLanguage,
                    prompt: whisperPrompt,
                    file: audioFile,
                    onProgress: async (seconds) => {
                        // Only update if WE still own the claim. Same
                        // ownership-token pattern as the release path —
                        // a stalled worker that wakes up to a stream
                        // event after a successor has taken over must
                        // not write progress onto the successor's row.
                        if (!claimedAt) return;
                        await db
                            .update(recordings)
                            .set({ transcriptionProgressSeconds: seconds })
                            .where(
                                and(
                                    eq(recordings.id, recordingId),
                                    eq(recordings.userId, userId),
                                    eq(
                                        recordings.transcribingStartedAt,
                                        claimedAt,
                                    ),
                                ),
                            );
                    },
                });
                transcriptionText = result.text;
                detectedLanguage = result.detectedLanguage;
            } else {
                const transcription = await openai.audio.transcriptions.create(
                    buildTranscriptionParams({
                        file: audioFile,
                        model,
                        responseFormat,
                        language: defaultLanguage,
                        prompt: whisperPrompt,
                    }),
                );
                const parsed = parseTranscriptionResponse(
                    transcription,
                    responseFormat,
                );
                transcriptionText = parsed.text;
                detectedLanguage = parsed.detectedLanguage;
            }
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

        // Chain the summary worker. The previous behavior left the
        // summary as a manual step the user had to click in the
        // dashboard, which broke the server-to-server flow (meets
        // posts a recording, gets the transcript, but no summary
        // ever lands). Fire-and-forget — we don't await because the
        // caller of `transcribeRecording` typically times out long
        // before a long meeting's summary completes, and the user
        // experience hinges on `transcription.completed` arriving
        // promptly. `summarizeRecording` emits its own `summary.created`
        // / `summary.failed` webhooks and handles its own errors, so
        // a bare catch here only guards against an unhandled rejection
        // crashing the process.
        if (transcriptionText.trim()) {
            void summarizeRecording(userId, recordingId).catch(
                (err: unknown) => {
                    console.error(
                        "Auto-summary trigger failed for",
                        recordingId,
                        err,
                    );
                },
            );
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
    } finally {
        // Release the in-flight claim only if WE still own it. The
        // ownership token is `transcribingStartedAt = claimedAt`: if a
        // successor has taken over via the stale-claim path, its
        // timestamp differs and the UPDATE matches zero rows — that's
        // the desired no-op (the successor keeps running with a valid
        // claim, and a third worker is blocked by it).
        //
        // Without this guard a worker that stalled past
        // `TRANSCRIPTION_STALE_TIMEOUT_MS`, then finally woke up and
        // hit its `finally`, would have cleared the live successor's
        // claim — letting yet another concurrent worker pass the
        // claim race. Bug surfaced by an automated review on the
        // upstream PR (cubic-dev-ai).
        //
        // A crash here (DB unavailable, etc.) is non-fatal — the stale
        // timeout is the backstop that recovers an abandoned claim on
        // the next attempt, so we just log and move on rather than
        // letting a release failure mask the original result.
        if (claimedRecordingId && claimedAt) {
            try {
                await db
                    .update(recordings)
                    .set({
                        transcribingStartedAt: null,
                        transcriptionProgressSeconds: null,
                    })
                    .where(
                        and(
                            eq(recordings.id, claimedRecordingId),
                            eq(recordings.userId, userId),
                            eq(recordings.transcribingStartedAt, claimedAt),
                        ),
                    );
            } catch (releaseError) {
                console.error(
                    "Failed to release transcription claim (will recover via stale timeout):",
                    releaseError,
                );
            }
        }
    }
}
