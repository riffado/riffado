import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// POST - Create a backup of all user data
export const POST = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    // Get all recordings for user
    const userRecordings = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        );

    // Get all transcriptions
    const recordingIds = userRecordings.map((r) => r.id);
    const userTranscriptions =
        recordingIds.length > 0
            ? await db
                  .select()
                  .from(transcriptions)
                  .where(eq(transcriptions.userId, session.user.id))
            : [];

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [t.recordingId, t]),
    );

    // Create backup data structure
    const backupData = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        userId: session.user.id,
        recordings: userRecordings.map((recording) => ({
            id: recording.id,
            filename: recording.filename,
            duration: recording.duration,
            startTime: recording.startTime,
            endTime: recording.endTime,
            filesize: recording.filesize,
            deviceSn: recording.deviceSn,
            transcription: transcriptionMap.get(recording.id) || null,
        })),
    };

    // Convert to JSON
    const backupJson = JSON.stringify(backupData, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${timestamp}.json`;

    return new NextResponse(backupJson, {
        headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
});
