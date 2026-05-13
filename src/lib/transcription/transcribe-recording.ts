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
import { chatTranscribe } from "@/lib/transcription/chat-transcribe";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { emitEvent } from "@/lib/webhooks/emit";

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
            .where(
                and(
                    eq(transcriptions.recordingId, recordingId),
                    eq(transcriptions.userId, userId),
                ),
            )
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
            const transcription = await openai.audio.transcriptions.create({
                file: audioFile,
                model,
                response_format: responseFormat,
                ...(defaultLanguage ? { language: defaultLanguage } : {}),
            });
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

                if (currentTranscription) {
                    await tx
                        .update(transcriptions)
                        .set({
                            text: encryptedTranscriptionText,
                            detectedLanguage,
                            transcriptionType: "server",
                            provider: credentials.provider,
                            model: credentials.defaultModel || "whisper-1",
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
                        model: credentials.defaultModel || "whisper-1",
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

        return { success: true };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        await emitEvent("transcription.failed", userId, recordingId, {
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
        };
    }
}
