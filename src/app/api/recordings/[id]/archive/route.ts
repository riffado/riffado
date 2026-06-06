import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

/**
 * POST /api/recordings/[id]/archive
 * Toggle archive status. Archived recordings disappear from the main dashboard
 * but remain fully intact. The body may contain { archive: boolean } to set
 * the state explicitly, or omit it to toggle.
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));

    const [recording] = await db
        .select({ id: recordings.id, archivedAt: recordings.archivedAt })
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

    // Explicit archive flag, or toggle.
    const shouldArchive =
        typeof body.archive === "boolean"
            ? body.archive
            : recording.archivedAt === null;

    const now = new Date();
    await db
        .update(recordings)
        .set({
            archivedAt: shouldArchive ? now : null,
            updatedAt: now,
        })
        .where(and(eq(recordings.id, id), eq(recordings.userId, userId)));

    return NextResponse.json({ success: true, archived: shouldArchive });
});
