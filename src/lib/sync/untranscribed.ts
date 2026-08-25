import { and, desc, eq, exists, isNull, not, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";

/** Max already-synced recordings to retry per sync. */
export const AUTO_TRANSCRIBE_RETRY_LIMIT = 5;

export type AutoTranscribeRetryOptions = {
    transcriptMode?: string;
    excludeIds?: readonly string[];
    limit?: number;
};

/**
 * Recording ids still eligible for auto-transcribe retry, newest first.
 * `keep_both` requires a missing Riffado-source transcript. `plaud_only`
 * (default) treats any transcript row as done.
 */
export async function listUntranscribedRecordingIds(
    userId: string,
    options: AutoTranscribeRetryOptions = {},
): Promise<string[]> {
    const limit = options.limit ?? AUTO_TRANSCRIBE_RETRY_LIMIT;
    const keepBoth = options.transcriptMode === "keep_both";
    const excludeIds = options.excludeIds ?? [];

    const sourceMatch = keepBoth
        ? and(
              eq(transcriptions.recordingId, recordings.id),
              eq(transcriptions.userId, userId),
              eq(transcriptions.source, "riffado"),
          )
        : and(
              eq(transcriptions.recordingId, recordings.id),
              eq(transcriptions.userId, userId),
          );

    const transcriptExists = exists(
        db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(sourceMatch),
    );

    const conditions = [
        eq(recordings.userId, userId),
        isNull(recordings.deletedAt),
        not(transcriptExists),
    ];
    if (excludeIds.length > 0) {
        conditions.push(notInArray(recordings.id, [...excludeIds]));
    }

    const rows = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(and(...conditions))
        .orderBy(desc(recordings.createdAt), desc(recordings.id))
        .limit(limit);

    return rows.map((row) => row.id);
}
