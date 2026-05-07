import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));
    const overrideProviderId = body.providerId as string | undefined;
    const overrideModel = body.model as string | undefined;

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

    // Get user's transcription API credentials
    // If a specific provider was requested, look it up by ID
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

    // Decrypt API key
    const apiKey = decrypt(credentials.apiKey);

    // Create OpenAI client (works with all OpenAI-compatible APIs)
    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    // Get storage provider and download audio
    const storage = await createUserStorageProvider(session.user.id);
    const audioBuffer = await storage.downloadFile(recording.storagePath);

    // Create a File object for the transcription API
    // Detect actual audio format from magic bytes since Plaud files
    // may have .mp3 extension but contain OGG/Opus data
    const header = new Uint8Array(audioBuffer.slice(0, 4));
    const isOgg =
        header[0] === 0x4f &&
        header[1] === 0x67 &&
        header[2] === 0x67 &&
        header[3] === 0x53; // "OggS"

    const ext = isOgg ? "ogg" : recording.storagePath.split(".").pop() || "mp3";
    const contentType = isOgg
        ? "audio/ogg"
        : recording.storagePath.endsWith(".mp3")
          ? "audio/mpeg"
          : "audio/opus";

    // Ensure filename has a valid extension so the API can detect the format
    const filename = recording.filename.match(/\.\w{2,4}$/)
        ? recording.filename
        : `${recording.filename}.${ext}`;

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

    // Atomic tombstone re-check + transcription upsert.
    //
    // The user may have deleted the recording while the (long-running)
    // provider call was in flight. To prevent a delete that lands
    // *between* our re-check and our upsert from being silently undone,
    // we run both inside a single transaction that takes a row-level
    // write lock (`FOR UPDATE`) on the recording. The DELETE handler's
    // transaction acquires the same lock via its `UPDATE recordings`
    // tombstone write, so the two transactions serialize: either we
    // see `deletedAt` set and abort, or our upsert commits before
    // DELETE runs and DELETE then cleans up our row inside its own tx.
    // See PR #72.
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
                .where(eq(transcriptions.recordingId, id))
                .limit(1);

            if (existingTranscription) {
                await tx
                    .update(transcriptions)
                    .set({
                        text: transcriptionText,
                        detectedLanguage,
                        transcriptionType: "server",
                        provider: credentials.provider,
                        model,
                    })
                    .where(eq(transcriptions.id, existingTranscription.id));
            } else {
                await tx.insert(transcriptions).values({
                    recordingId: id,
                    userId: session.user.id,
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model,
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
        transcription: transcriptionText,
        detectedLanguage,
    });
});
