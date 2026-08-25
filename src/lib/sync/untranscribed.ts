import { and, asc, eq, exists, isNull, not } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";

/** Max already-synced recordings without a transcript to retry per sync. */
export const AUTO_TRANSCRIBE_RETRY_LIMIT = 5;

/** Recording ids with no transcript row, oldest first. */
export async function listUntranscribedRecordingIds(
    userId: string,
    limit = AUTO_TRANSCRIBE_RETRY_LIMIT,
): Promise<string[]> {
    const transcriptExists = exists(
        db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recordings.id),
                    eq(transcriptions.userId, userId),
                ),
            ),
    );

    const rows = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, userId),
                isNull(recordings.deletedAt),
                not(transcriptExists),
            ),
        )
        .orderBy(asc(recordings.createdAt), asc(recordings.id))
        .limit(limit);

    return rows.map((row) => row.id);
}
