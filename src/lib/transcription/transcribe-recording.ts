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
import { decrypt } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";

export async function transcribeRecording(
    userId: string,
    recordingId: string,
): Promise<{ success: boolean; error?: string }> {
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
            return { success: false, error: "Recording not found" };
        }

        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        if (existingTranscription?.text) {
            return { success: true };
        }

        const [credentials] = await db
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
            return { success: false, error: "No transcription API configured" };
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
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        const contentType = recording.storagePath.endsWith(".mp3")
            ? "audio/mpeg"
            : "audio/opus";
        // `recording.filename` is encrypted at rest; decrypt before passing
        // to the transcription provider as a filename hint.
        const decryptedFilename = decryptText(recording.filename);
        const audioFile = new File(
            [new Uint8Array(audioBuffer)],
            decryptedFilename,
            {
                type: contentType,
            },
        );

        const model = credentials.defaultModel || "whisper-1";

        const responseFormat = getResponseFormat(model);

        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model,
            response_format: responseFormat,
            ...(defaultLanguage ? { language: defaultLanguage } : {}),
        });

        const { text: transcriptionText, detectedLanguage } =
            parseTranscriptionResponse(transcription, responseFormat);

        // Re-check tombstone after the provider call. The user may have
        // deleted the recording while we were waiting on the transcription
        // API; abort before writing so we don't recreate child rows the
        // DELETE handler has already cleaned up.
        const [stillActive] = await db
            .select({ deletedAt: recordings.deletedAt })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                ),
            )
            .limit(1);
        if (!stillActive || stillActive.deletedAt) {
            return {
                success: false,
                error: "Recording was deleted before transcription finished",
            };
        }

        // Encrypt the transcript before persisting.
        const encryptedTranscriptionText = encryptText(transcriptionText);
        if (existingTranscription) {
            await db
                .update(transcriptions)
                .set({
                    text: encryptedTranscriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model: credentials.defaultModel || "whisper-1",
                })
                .where(eq(transcriptions.id, existingTranscription.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId,
                userId,
                text: encryptedTranscriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model: credentials.defaultModel || "whisper-1",
            });
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
                        .where(eq(recordings.id, recordingId));

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

        return { success: true };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
        };
    }
}
