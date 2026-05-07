import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
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

    // Get storage provider
    const storage = await createUserStorageProvider(session.user.id);

    // Download file
    const audioBuffer = await storage.downloadFile(recording.storagePath);

    // Determine content type from file extension
    const getContentType = (path: string): string => {
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".opus")) return "audio/opus";
        if (path.endsWith(".wav")) return "audio/wav";
        if (path.endsWith(".m4a")) return "audio/mp4";
        if (path.endsWith(".ogg")) return "audio/ogg";
        if (path.endsWith(".webm")) return "audio/webm";
        // Default to mpeg for unknown types (as most Plaud recordings are MP3)
        return "audio/mpeg";
    };

    const contentType = getContentType(recording.storagePath);
    const fileSize = audioBuffer.length;

    // Parse Range header for seeking support
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
        // Parse range header (e.g., "bytes=0-1023" or "bytes=1024-")
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);

        if (rangeMatch) {
            const start = Number.parseInt(rangeMatch[1], 10);
            const end = rangeMatch[2]
                ? Number.parseInt(rangeMatch[2], 10)
                : fileSize - 1;

            // Validate range values. We return raw 416 (without our error
            // envelope) because `Content-Range: bytes */N` is the contract
            // browsers parse, and they don't read JSON on a 416.
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

            // Extract the requested chunk
            const chunk = audioBuffer.slice(start, end + 1);

            // Return 206 Partial Content
            return new NextResponse(new Uint8Array(chunk), {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": chunkSize.toString(),
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "public, max-age=31536000, immutable",
                },
            });
        }
    }

    // No range requested - return full file
    return new NextResponse(new Uint8Array(audioBuffer), {
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileSize.toString(),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
});
