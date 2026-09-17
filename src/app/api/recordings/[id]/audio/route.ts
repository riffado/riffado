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
import { getAudioMimeType } from "@/lib/utils";

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

    const storage = await createUserStorageProvider(session.user.id);
    const audioBuffer = await storage.downloadFile(recording.storagePath);
    const contentType = getAudioMimeType(recording.storagePath);
    const fileSize = audioBuffer.length;
    const wantsDownload = isAudioDownloadRequest(request);

    const downloadHeaders: Record<string, string> = wantsDownload
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
        : {
              "Cache-Control": "public, max-age=31536000, immutable",
          };

    // Attachment downloads always return the full file so the saved
    // copy is complete. Range is still honored for in-app playback.
    const rangeHeader = wantsDownload ? null : request.headers.get("range");

    if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);

        if (rangeMatch) {
            const start = Number.parseInt(rangeMatch[1], 10);
            const end = rangeMatch[2]
                ? Number.parseInt(rangeMatch[2], 10)
                : fileSize - 1;

            if (
                start < 0 ||
                start >= fileSize ||
                end < 0 ||
                end >= fileSize ||
                start > end
            ) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        "Content-Range": `bytes */${fileSize}`,
                    },
                });
            }

            const chunkSize = end - start + 1;
            const chunk = audioBuffer.slice(start, end + 1);

            return new NextResponse(new Uint8Array(chunk), {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": chunkSize.toString(),
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    ...downloadHeaders,
                },
            });
        }
    }

    return new NextResponse(new Uint8Array(audioBuffer), {
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileSize.toString(),
            "Accept-Ranges": "bytes",
            ...downloadHeaders,
        },
    });
});
