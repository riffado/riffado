import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, recordings, transcriptions } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decrypt } from "@/lib/encryption";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import { emitEvent } from "@/lib/webhooks/emit";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    try {
        const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
        >;
        const overrideProviderId =
            typeof body.providerId === "string" ? body.providerId : undefined;
        const overrideModel =
            typeof body.model === "string" ? body.model : undefined;

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

        const [credentials] = overrideProviderId
            ? await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.id, overrideProviderId),
                          eq(apiCredentials.userId, session.user.id),
                      ),
                  )
                  .limit(1)
            : await db
                  .select()
                  .from(apiCredentials)
                  .where(
                      and(
                          eq(apiCredentials.userId, session.user.id),
                          eq(apiCredentials.isDefaultTranscription, true),
                      ),
                  )
                  .limit(1);

        if (!credentials) {
            throw new AppError(
                ErrorCode.NO_TRANSCRIPTION_PROVIDER,
                "No transcription API configured",
                400,
            );
        }

        const apiKey = decrypt(credentials.apiKey);
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        const storage = await createUserStorageProvider(session.user.id);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        const header = new Uint8Array(audioBuffer.slice(0, 4));
        const isOgg =
            header[0] === 0x4f &&
            header[1] === 0x67 &&
            header[2] === 0x67 &&
            header[3] === 0x53;

        const ext = isOgg
            ? "ogg"
            : recording.storagePath.split(".").pop() || "mp3";
        const contentType = isOgg
            ? "audio/ogg"
            : recording.storagePath.endsWith(".mp3")
              ? "audio/mpeg"
              : "audio/opus";

        const decryptedFilename = decryptText(recording.filename);
        const filename = decryptedFilename.match(/\.\w{2,4}$/)
            ? decryptedFilename
            : `${decryptedFilename}.${ext}`;

        const audioFile = new File([new Uint8Array(audioBuffer)], filename, {
            type: contentType,
        });

        const model = overrideModel || credentials.defaultModel || "whisper-1";
        const responseFormat = getResponseFormat(model);

        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model,
            response_format: responseFormat,
        });

        const { text: transcriptionText, detectedLanguage } =
            parseTranscriptionResponse(transcription, responseFormat);

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

                const [existingTranscription] = await tx
                    .select()
                    .from(transcriptions)
                    .where(
                        and(
                            eq(transcriptions.recordingId, id),
                            eq(transcriptions.userId, session.user.id),
                        ),
                    )
                    .limit(1);

                const encryptedText = encryptText(transcriptionText);

                if (existingTranscription) {
                    await tx
                        .update(transcriptions)
                        .set({
                            text: encryptedText,
                            detectedLanguage,
                            transcriptionType: "server",
                            provider: credentials.provider,
                            model,
                        })
                        .where(
                            and(
                                eq(
                                    transcriptions.id,
                                    existingTranscription.id,
                                ),
                                eq(transcriptions.userId, session.user.id),
                            ),
                        );
                } else {
                    await tx.insert(transcriptions).values({
                        recordingId: id,
                        userId: session.user.id,
                        text: encryptedText,
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
                            eq(recordings.id, id),
                            eq(recordings.userId, session.user.id),
                            isNull(recordings.deletedAt),
                        ),
                    );
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

        await emitEvent("transcription.completed", session.user.id, id);

        return NextResponse.json({
            transcription: transcriptionText,
            detectedLanguage,
        });
    } catch (error) {
        await emitEvent("transcription.failed", session.user.id, id, {
            error: error instanceof Error ? error.message : String(error),
        }).catch((eventError) => {
            console.error("Failed to emit transcription failure event:", eventError);
        });
        throw error;
    }
});
