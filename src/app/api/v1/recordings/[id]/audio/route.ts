import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { getAudioMimeType } from "@/lib/utils";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const authn = await authenticateRequest(request);
        if (!authn) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, authn.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        const storage = await createUserStorageProvider(authn.user.id);

        if (recording.storageType === "s3") {
            const signedUrl = await storage.getSignedUrl(
                recording.storagePath,
                300,
            );
            return NextResponse.redirect(signedUrl, 302);
        }

        const audioBuffer = await storage.downloadFile(recording.storagePath);
        const contentType = getAudioMimeType(recording.storagePath);
        const fileSize = audioBuffer.length;
        const rangeHeader = request.headers.get("range");

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

                const chunk = audioBuffer.slice(start, end + 1);
                const chunkSize = end - start + 1;

                return new NextResponse(new Uint8Array(chunk), {
                    status: 206,
                    headers: {
                        "Content-Type": contentType,
                        "Content-Length": chunkSize.toString(),
                        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                        "Accept-Ranges": "bytes",
                        "Cache-Control": "private, max-age=300",
                    },
                });
            }
        }

        return new NextResponse(new Uint8Array(audioBuffer), {
            headers: {
                "Content-Type": contentType,
                "Content-Length": fileSize.toString(),
                "Accept-Ranges": "bytes",
                "Cache-Control": "private, max-age=300",
            },
        });
    } catch (error) {
        console.error("Error fetching v1 audio:", error);
        return NextResponse.json(
            { error: "Failed to fetch audio" },
            { status: 500 },
        );
    }
}
