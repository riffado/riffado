import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";

type IdContext = { params: Promise<{ id: string }> };

export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;

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

    // Get transcription if exists
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, id))
        .limit(1);

    return NextResponse.json({
        recording,
        transcription: transcription || null,
    });
});

/**
 * Storage providers throw on any deleteFile error including "object not
 * present". Detect the not-found case so retries after a half-failed delete
 * still tombstone cleanly.
 *
 * Prefer typed signals over message matching:
 *   - Node fs: `error.code === "ENOENT"`
 *   - AWS SDK v3: `error.name` is `"NoSuchKey"` or `"NotFound"`, or
 *     `error.$metadata?.httpStatusCode === 404`
 *
 * Fall back to a narrow substring match for adapters that wrap their
 * underlying error (rare, but the local-fs adapter has done it before).
 * The fallback is anchored to known not-found phrases rather than the
 * raw `\b404\b` regex, which previously could match `request_id=...404abc`
 * style strings inside otherwise-unrelated 5xx errors.
 */
function isStorageNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as {
        code?: unknown;
        name?: unknown;
        message?: unknown;
        $metadata?: { httpStatusCode?: unknown };
    };
    if (e.code === "ENOENT") return true;
    if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
    if (e.$metadata?.httpStatusCode === 404) return true;
    if (typeof e.message === "string") {
        // Narrow substring fallback only — anchored to phrases adapters
        // actually emit, not bare 404 anywhere in the string.
        return /(ENOENT|NoSuchKey|NotFound|no such file or directory)/i.test(
            e.message,
        );
    }
    return false;
}

/**
 * Soft-delete a recording.
 *
 * Order of operations is important:
 *
 * 1. Hard-delete the audio file from storage. If the storage provider fails
 *    for any reason other than "already gone", abort with 500 — we do NOT
 *    tombstone, so the user can retry instead of being left with an orphan
 *    blob that storage-usage stats can't see.
 * 2. Run all DB writes (transcription rows, AI-enhancement rows, tombstone
 *    update on `recordings.deletedAt`) inside a single transaction. Either
 *    they all commit or none do, so a partial failure can't leave the user
 *    with a half-deleted recording (e.g. transcript gone but row still
 *    visible).
 *
 * The tombstone (instead of a hard delete) exists because sync is keyed on
 * `recordings.plaudFileId`. Without it, the next pull from Plaud would
 * resurrect the recording. This endpoint does NOT delete the file on
 * Plaud's servers — Plaud remains the upstream source of truth.
 */
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;
    const userId = session.user.id;

    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, userId),
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

    // 1. Storage delete first. Treat "already gone" as success; surface
    //    every other error so the user can retry.
    try {
        const storage = await createUserStorageProvider(userId);
        await storage.deleteFile(recording.storagePath);
    } catch (storageError) {
        if (!isStorageNotFoundError(storageError)) {
            console.error(
                `Failed to delete storage file for recording ${id}:`,
                storageError,
            );
            throw new AppError(
                ErrorCode.STORAGE_ERROR,
                "Failed to delete recording audio. Please retry.",
                500,
            );
        }
        // Object already absent — continue with tombstone.
    }

    // 2. Atomic DB writes: child rows + tombstone in one transaction.
    await db.transaction(async (tx) => {
        await tx
            .delete(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, userId),
                ),
            );

        await tx
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, userId),
                ),
            );

        await tx
            .update(recordings)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                ),
            );
    });

    return NextResponse.json({ success: true });
});
