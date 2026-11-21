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
    isAudioStreamRequest,
} from "@/lib/recordings/filename";
import { isStorageObjectMissingError } from "@/lib/storage/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import type { ByteRange } from "@/lib/storage/types";
import { getAudioMimeType } from "@/lib/utils";

type IdContext = { params: Promise<{ id: string }> };

const PLAYBACK_URL_TTL_SECONDS = 15 * 60;

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

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
    const match = SINGLE_BYTE_RANGE.exec(header.trim());
    if (!match) return null;
    const [, startText, endText] = match;
    if (startText === "") {
        if (endText === "") return null;
        const suffixLength = Number(endText);
        if (suffixLength === 0 || size === 0) return "unsatisfiable";
        return { start: Math.max(0, size - suffixLength), end: size - 1 };
    }
    const start = Number(startText);
    if (endText !== "" && Number(endText) < start) return null;
    if (start >= size) return "unsatisfiable";
    const requestedEnd = endText === "" ? size - 1 : Number(endText);
    return { start, end: Math.min(requestedEnd, size - 1) };
}

async function readAudio<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (error) {
        if (isStorageObjectMissingError(error)) {
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                "Recording audio not found",
                404,
            );
        }
        throw error;
    }
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
        !isAudioStreamRequest(request) &&
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

    const fileSize = await readAudio(() =>
        storage.getObjectSize(recording.storagePath),
    );

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
        : { "Cache-Control": "private, max-age=300", Vary: "Sec-Fetch-Dest" };

    // Attachment downloads always return the full file so the saved
    // copy is complete. Range is still honored for in-app playback.
    const range = wantsDownload
        ? null
        : parseRange(request.headers.get("range"), fileSize);

    if (range === "unsatisfiable") {
        return new NextResponse(null, {
            status: 416,
            headers: {
                "Content-Range": `bytes */${fileSize}`,
                "Cache-Control": "private, no-store",
            },
        });
    }

    if (range) {
        const stream = await readAudio(() =>
            storage.downloadStream(recording.storagePath, range),
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

    const stream = await readAudio(() =>
        storage.downloadStream(recording.storagePath),
    );
    return new NextResponse(toBody(stream), {
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileSize.toString(),
            "Accept-Ranges": "bytes",
            ...cacheHeaders,
        },
    });
});
