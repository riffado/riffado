import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { encryptText } from "@/lib/encryption/fields";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import type { TranscribeResult } from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";
import type { TranscriptionModel } from "@/types/transcription";

/**
 * Generate an AI title from a fresh transcript and persist it as the
 * recording's filename (encrypted at rest), optionally pushing it back
 * to Plaud. Shared by the server-side and browser transcription paths
 * so the two cannot drift. Best-effort: failures are logged and
 * swallowed -- a missing title must never fail an otherwise-successful
 * transcription.
 */
export async function maybeGenerateAndSyncTitle(params: {
    userId: string;
    recordingId: string;
    plaudFileId: string;
    transcriptionText: string;
    autoGenerateTitle: boolean;
    syncTitleToPlaud: boolean;
}): Promise<void> {
    const {
        userId,
        recordingId,
        plaudFileId,
        transcriptionText,
        autoGenerateTitle,
        syncTitleToPlaud,
    } = params;

    if (!autoGenerateTitle || !transcriptionText.trim()) {
        return;
    }

    try {
        const generatedTitle = await generateTitleFromTranscription(
            userId,
            transcriptionText,
        );

        if (!generatedTitle) {
            return;
        }

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

        if (!syncTitleToPlaud) {
            return;
        }

        try {
            const [connection] = await db
                .select()
                .from(plaudConnections)
                .where(eq(plaudConnections.userId, userId))
                .limit(1);

            if (!connection) {
                return;
            }

            const plaudClient = await createPlaudClient(
                connection.bearerToken,
                connection.apiBase,
                connection.workspaceId,
            );
            await plaudClient.updateFilename(plaudFileId, generatedTitle);

            // Backfill workspaceId if newly resolved. Always scope
            // user-owned UPDATEs by userId even when filtering by id
            // (per AGENTS.md).
            const resolved = plaudClient.workspaceId;
            if (resolved && resolved !== connection.workspaceId) {
                await db
                    .update(plaudConnections)
                    .set({ workspaceId: resolved })
                    .where(
                        and(
                            eq(plaudConnections.id, connection.id),
                            eq(plaudConnections.userId, userId),
                        ),
                    );
            }
        } catch (error) {
            console.error("Failed to sync title to Plaud:", error);
        }
    } catch (error) {
        console.error("Failed to generate title:", error);
    }
}

/**
 * Persist a transcript produced in the user's browser (Transformers.js /
 * Whisper running client-side via WebAssembly). No provider call happens
 * here -- the text arrives already-computed from the client. We still
 * own the storage path so a browser transcript is indistinguishable from
 * a server one downstream: encrypted at rest, title auto-generation,
 * webhook emission, and the same tombstone-race guard.
 *
 * The transcript is always upserted (browser is an explicit user choice,
 * so it overwrites any existing transcript -- there is no idempotent
 * short-circuit like the sync-triggered server path has).
 */
export async function storeBrowserTranscription(
    userId: string,
    recordingId: string,
    input: {
        text: string;
        detectedLanguage: string | null;
        model: TranscriptionModel;
    },
): Promise<TranscribeResult> {
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

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

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

                const encryptedTranscriptionText = encryptText(input.text);

                if (currentTranscription) {
                    await tx
                        .update(transcriptions)
                        .set({
                            text: encryptedTranscriptionText,
                            detectedLanguage: input.detectedLanguage,
                            transcriptionType: "browser",
                            provider: "browser",
                            model: input.model,
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
                        detectedLanguage: input.detectedLanguage,
                        transcriptionType: "browser",
                        provider: "browser",
                        model: input.model,
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

        await maybeGenerateAndSyncTitle({
            userId,
            recordingId,
            plaudFileId: recording.plaudFileId,
            transcriptionText: input.text,
            autoGenerateTitle,
            syncTitleToPlaud,
        });

        await emitEvent("transcription.completed", userId, recordingId);

        return {
            success: true,
            text: input.text,
            detectedLanguage: input.detectedLanguage,
        };
    } catch (error) {
        console.error("Error storing browser transcription:", error);
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
