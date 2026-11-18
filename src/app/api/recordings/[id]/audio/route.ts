import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    buildDownloadFilename,
    contentDispositionAttachment,
    isAudioDownloadRequest,
} from "@/lib/recordings/filename";
import { createUserStorageProvider } from "@/lib/storage/factory";
import type { ByteRange } from "@/lib/storage/types";
import { getAudioMimeType } from "@/lib/utils";

type IdContext = { params: Promise<{ id: string }> };

const PLAYBACK_URL_TTL_SECONDS = 60 * 60;

const MEDIA_ELEMENT_DESTINATIONS = new Set(["audio", "video"]);

function isMediaElementRequest(request: Request): boolean {
    const destination = request.headers.get("sec-fetch-dest");
    return destination !== null && MEDIA_ELEMENT_DESTINATIONS.has(destination);
}

function parseRange(
    header: string | null,
    size: number,
): ByteRange | "unsatisfiable" | null {
    if (!header) return null;
    const match = header.match(/bytes=(\d+)-(\d*)/);
    if (!match) return null;
    const start = Number.parseInt(match[1], 10);
    const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : size - 1;
    const end = Math.min(requestedEnd, size - 1);
    if (start >= size || start > end) return "unsatisfiable";
    return { start, end };
}

function toBody(stream: Readable): ReadableStream {
    return Readable.toWeb(stream) as ReadableStream;
}

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

    const storage = await createUserStorageProvider(session.user.id);
    const contentType = getAudioMimeType(recording.storagePath);
    const wantsDownload = isAudioDownloadRequest(request);

    if (
        !wantsDownload &&
        storage.getDirectDownloadUrl &&
        isMediaElementRequest(request)
    ) {
        const url = await storage.getDirectDownloadUrl(recording.storagePath, {
            expiresInSeconds: PLAYBACK_URL_TTL_SECONDS,
            contentType,
        });
        const redirect = NextResponse.redirect(url, 302);
        redirect.headers.set("Cache-Control", "private, no-store");
        return redirect;
    }

    const fileSize = await storage.getObjectSize(recording.storagePath);

    const cacheHeaders: Record<string, string> = wantsDownload
        ? {
              "Content-Disposition": contentDispositionAttachment(
                  buildDownloadFilename(
                      decryptText(recording.filename),
                      recording.storagePath,
                      recording.id,
                  ),
              ),
              "Cache-Control": "private, no-store",
          }
        : { "Cache-Control": "private, max-age=300" };

    // Attachment downloads always return the full file so the saved
    // copy is complete. Range is still honored for in-app playback.
    const range = wantsDownload
        ? null
        : parseRange(request.headers.get("range"), fileSize);

    if (range === "unsatisfiable") {
        return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
        });
    }

    if (range) {
        const stream = await storage.downloadStream(
            recording.storagePath,
            range,
        );
        return new NextResponse(toBody(stream), {
            status: 206,
            headers: {
                "Content-Type": contentType,
                "Content-Length": (range.end - range.start + 1).toString(),
                "Content-Range": `bytes ${range.start}-${range.end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                ...cacheHeaders,
            },
        });
    }

    const stream = await storage.downloadStream(recording.storagePath);
    return new NextResponse(toBody(stream), {
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileSize.toString(),
            "Accept-Ranges": "bytes",
            ...cacheHeaders,
        },
    });
});
