import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudFiletags, recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    assertJsonObjectBody,
    getPlaudClientForUser,
    isLocalOnlyRecording,
} from "@/lib/filetags/service";
import { emitEvent } from "@/lib/webhooks/emit";

const MAX_RECORDING_IDS = 100;

/**
 * Bulk directory assignment: `filetagId: null` moves the recordings to
 * Unorganized. Bulk because Plaud's own endpoint is bulk and a future
 * multi-selection UI reuses it as-is.
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = await request.json().catch(() => ({}));
    assertJsonObjectBody(body);

    const rawIds = body.recordingIds;
    if (
        !Array.isArray(rawIds) ||
        rawIds.length === 0 ||
        rawIds.length > MAX_RECORDING_IDS ||
        rawIds.some((id) => typeof id !== "string" || !id)
    ) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `recordingIds must be an array of 1-${MAX_RECORDING_IDS} ids`,
            400,
            { field: "recordingIds" },
        );
    }
    const recordingIds = Array.from(new Set(rawIds as string[]));

    if (body.filetagId !== null && typeof body.filetagId !== "string") {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "filetagId must be a string or null",
            400,
            { field: "filetagId" },
        );
    }

    // Resolve the target directory (null = Unorganized), user-scoped.
    let targetTag: typeof plaudFiletags.$inferSelect | null = null;
    if (typeof body.filetagId === "string") {
        const [tag] = await db
            .select()
            .from(plaudFiletags)
            .where(
                and(
                    eq(plaudFiletags.id, body.filetagId),
                    eq(plaudFiletags.userId, session.user.id),
                ),
            )
            .limit(1);
        if (!tag) {
            throw new AppError(
                ErrorCode.NOT_FOUND,
                "Directory not found",
                404,
                { id: body.filetagId },
            );
        }
        targetTag = tag;
    }

    const rows = await db
        .select({
            id: recordings.id,
            plaudFileId: recordings.plaudFileId,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                inArray(recordings.id, recordingIds),
                isNull(recordings.deletedAt),
            ),
        );

    if (rows.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, "No recordings found", 404);
    }

    const plaudRows = rows.filter((row) => !isLocalOnlyRecording(row));

    // A local-only directory assigned to Plaud-backed recordings would be
    // silently undone by the next sync reconciliation — refuse instead.
    if (targetTag && targetTag.plaudTagId === null && plaudRows.length > 0) {
        throw new AppError(
            ErrorCode.CONFLICT,
            "This directory exists only in Riffado and cannot hold Plaud recordings. Create it while connected to Plaud, or move only uploaded recordings.",
            409,
        );
    }

    // Write-through: update Plaud first; abort without touching the DB on
    // failure. Local-only recordings never hit Plaud.
    if (plaudRows.length > 0) {
        const plaud = await getPlaudClientForUser(session.user.id);
        if (!plaud) {
            throw new AppError(
                ErrorCode.PLAUD_NOT_CONNECTED,
                "These recordings live on Plaud, but no Plaud account is connected.",
                409,
            );
        }
        await plaud.client.updateFileTags(
            plaudRows.map((row) => row.plaudFileId),
            targetTag?.plaudTagId ?? "",
        );
        await plaud.persistWorkspaceId();
    }

    const foundIds = rows.map((row) => row.id);
    await db
        .update(recordings)
        .set({
            filetagId: targetTag?.id ?? null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(recordings.userId, session.user.id),
                inArray(recordings.id, foundIds),
                isNull(recordings.deletedAt),
            ),
        );

    for (const id of foundIds) {
        await emitEvent("recording.updated", session.user.id, id);
    }

    return NextResponse.json({ success: true, moved: foundIds.length });
});
