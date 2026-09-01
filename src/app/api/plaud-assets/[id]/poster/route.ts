import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";

type IdContext = { params: Promise<{ id: string }> };

/**
 * Serve the "summary poster" PNG stored alongside an imported Plaud
 * summary, from object storage at a key derived from the owning recording.
 *
 * Access is gated on the caller owning the recording, exactly like the
 * audio route, because the poster reproduces the summary content. Cached
 * as `private` so a shared cache can never hand one user's poster to
 * another.
 *
 * Referenced from imported summary markdown as
 * `/api/plaud-assets/<recordingId>/poster`.
 */
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const [recording] = await db
        .select({ id: recordings.id })
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

    const key = `${session.user.id}/plaud-poster-${id}.png`;
    const storage = await createUserStorageProvider(session.user.id);

    let poster: Buffer;
    try {
        poster = await storage.downloadFile(key);
    } catch {
        throw new AppError(ErrorCode.NOT_FOUND, "Poster not found", 404);
    }

    return new NextResponse(new Uint8Array(poster), {
        headers: {
            "Content-Type": "image/png",
            "Content-Length": poster.length.toString(),
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    });
});
