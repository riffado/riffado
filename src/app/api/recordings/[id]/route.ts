import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    aiEnhancements,
    recordings,
    transcriptions,
    webhookDeliveries,
} from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { emitEvent } from "@/lib/webhooks/emit";
import { createRedactedWebhookPayload } from "@/lib/webhooks/payload";

const CONTEXT_MAX_LEN = 4000;

type IdContext = { params: Promise<{ id: string }> };

export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

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

    // Get transcription if exists. Defense-in-depth: scope by userId
    // even though the parent recording lookup already filtered. If a row
    // ever ends up with mismatched (recordingId, userId) due to a bug or
    // a partially-failed delete, this prevents cross-tenant reads.
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, id),
                eq(transcriptions.userId, session.user.id),
            ),
        )
        .limit(1);

    // Decrypt content fields before returning to the client. The DB
    // holds ciphertext (or, during the deploy → backfill window, legacy
    // plaintext); the client always sees plaintext.
    return NextResponse.json({
        recording: {
            ...recording,
            filename: decryptText(recording.filename),
            context: recording.context
                ? decryptText(recording.context)
                : null,
        },
        transcription: transcription
            ? { ...transcription, text: decryptText(transcription.text) }
            : null,
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
 * Update mutable fields on a recording. Only `context` for now —
 * extending this rather than adding a one-field route so future
 * editable fields don't accrue more endpoints. Encrypts at rest.
 * `context: null` (explicit) clears the field; omitting the key
 * leaves it untouched.
 */
export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const body = (await request.json().catch(() => ({}))) as {
        context?: string | null;
    };

    if (!Object.hasOwn(body, "context")) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Nothing to update",
            400,
        );
    }

    const next = body.context;
    if (next != null) {
        if (typeof next !== "string") {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "context must be a string or null",
                400,
                { field: "context" },
            );
        }
        if (next.length > CONTEXT_MAX_LEN) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                `context must be ${CONTEXT_MAX_LEN} characters or fewer`,
                400,
                { field: "context" },
            );
        }
    }

    // Trim+collapse: a textarea that the user blanked produces "" not
    // null. Both should clear the column so the LLM doesn't get an
    // empty-string primer that pollutes Whisper's prompt budget.
    const trimmed = typeof next === "string" ? next.trim() : null;
    const stored = trimmed ? encryptText(trimmed) : null;

    const updated = await db
        .update(recordings)
        .set({ context: stored, updatedAt: new Date() })
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .returning({ id: recordings.id });

    if (updated.length === 0) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    return NextResponse.json({
        success: true,
        context: trimmed,
    });
});

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
    const session = await requireApiSession(request);

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

    // 2. Atomic DB writes: child rows, webhook delivery payload redaction,
    //    and tombstone in one transaction.
    const didTombstone = await db.transaction(async (tx) => {
        const now = new Date();

        // Lock the parent recording row up front. Without this, a
        // concurrent transcribe/summary writer (which also re-checks
        // tombstone under FOR UPDATE) could slip a new transcript or
        // ai_enhancement row in between our child-row deletes and the
        // final tombstone, leaving orphan rows pointing at a tombstoned
        // recording. With the lock, concurrent writers either run before
        // us (their rows get deleted by the child-row deletes below) or
        // after us (they observe `deletedAt != null` and bail).
        const [locked] = await tx
            .select({ deletedAt: recordings.deletedAt })
            .from(recordings)
            .where(and(eq(recordings.id, id), eq(recordings.userId, userId)))
            .for("update")
            .limit(1);

        // A concurrent DELETE already tombstoned and committed; nothing
        // for us to do. Return false so we don't emit a duplicate event.
        if (!locked || locked.deletedAt) return false;

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
            .update(webhookDeliveries)
            .set({
                payload: createRedactedWebhookPayload(id, now),
                updatedAt: now,
            })
            .where(
                and(
                    eq(webhookDeliveries.recordingId, id),
                    eq(webhookDeliveries.userId, userId),
                ),
            );

        // Returning lets us tell whether THIS request flipped the
        // tombstone vs. a concurrent DELETE having already done it. We
        // only want to emit `recording.deleted` for the winning request.
        const tombstoned = await tx
            .update(recordings)
            .set({ deletedAt: now, updatedAt: now })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                ),
            )
            .returning({ id: recordings.id });

        return tombstoned.length > 0;
    });

    if (didTombstone) {
        await emitEvent("recording.deleted", userId, id);
    }

    return NextResponse.json({ success: true });
});
