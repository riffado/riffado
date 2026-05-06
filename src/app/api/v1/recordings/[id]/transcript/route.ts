import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { serializeTranscript } from "@/lib/v1/serialize";

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
            .select({ id: recordings.id })
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

        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recording.id),
                    eq(transcriptions.userId, authn.user.id),
                ),
            )
            .limit(1);

        if (!transcription) {
            return NextResponse.json(
                { error: "Transcript not found" },
                { status: 404 },
            );
        }

        return NextResponse.json(serializeTranscript(transcription));
    } catch (error) {
        console.error("Error fetching v1 transcript:", error);
        return NextResponse.json(
            { error: "Failed to fetch transcript" },
            { status: 500 },
        );
    }
}
