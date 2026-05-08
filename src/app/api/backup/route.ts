import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { apiHandler } from "@/lib/errors";

// POST - Create a backup of all user data
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

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

    // Decrypt content before serialization — the backup is the user's
    // plaintext export, which they own off-system from this point.
    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { ...t, text: decryptText(t.text) },
        ]),
    );

    // Create backup data structure
    const backupData = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        userId: session.user.id,
        recordings: userRecordings.map((recording) => ({
            id: recording.id,
            filename: decryptText(recording.filename),
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
