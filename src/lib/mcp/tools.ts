import type { SQL } from "drizzle-orm";
import { and, desc, eq, exists, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudDevices,
    recordings,
    transcriptions,
} from "@/db/schema";
import { decryptText } from "@/lib/encryption/fields";
import {
    decodeRecordingCursor,
    encodeRecordingCursor,
    getPreferredTranscriptSource,
    getV1RecordingDetailForUser,
    resolvePrimaryTranscript,
    serializeRecording,
    serializeSummary,
    serializeTranscript,
    type V1Recording,
    type V1RecordingDetail,
    type V1Summary,
    type V1Transcript,
} from "@/lib/v1/serialize";

/** Recordings scanned by `search_recordings`, newest first. */
export const SEARCH_WINDOW = 500;

const SEARCH_TRANSCRIPT_PAGE_SIZE = 50;
const SNIPPET_LENGTH = 160;

/** Page of recordings in the same shape as `GET /api/v1/recordings`. */
export type RecordingListPage = {
    data: V1Recording[];
    next_cursor: string | null;
    has_more: boolean;
};

/** One `search_recordings` hit. */
export type RecordingSearchMatch = {
    id: string;
    title: string;
    recorded_at: string;
    duration_ms: number;
    matched_in: Array<"title" | "transcript">;
    snippet: string | null;
};

/** Result of looking up something that belongs to one recording. */
export type RecordingLookup<T> =
    | { status: "recording_not_found" }
    | { status: "missing" }
    | { status: "ok"; value: T };

/**
 * Lists the user's non-deleted recordings with the ordering, cursor format and
 * item shape of `GET /api/v1/recordings`. Returns `null` for an invalid cursor.
 */
export async function listRecordingsForUser(
    userId: string,
    options: { limit: number; cursor?: string },
): Promise<RecordingListPage | null> {
    const conditions: SQL[] = [
        eq(recordings.userId, userId),
        isNull(recordings.deletedAt),
    ];

    if (options.cursor) {
        const cursor = decodeRecordingCursor(options.cursor);
        if (!cursor) return null;
        conditions.push(
            or(
                lt(recordings.updatedAt, cursor.updatedAt),
                and(
                    eq(recordings.updatedAt, cursor.updatedAt),
                    lt(recordings.id, cursor.id),
                ),
            ) as SQL,
        );
    }

    const transcriptExists = exists(
        db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recordings.id),
                    eq(transcriptions.userId, userId),
                ),
            ),
    );

    const rows = await db
        .select({
            recording: recordings,
            device: plaudDevices,
            enhancement: aiEnhancements,
            hasTranscript: transcriptExists,
        })
        .from(recordings)
        .leftJoin(
            plaudDevices,
            and(
                eq(plaudDevices.userId, userId),
                eq(plaudDevices.serialNumber, recordings.deviceSn),
            ),
        )
        .leftJoin(
            aiEnhancements,
            and(
                eq(aiEnhancements.recordingId, recordings.id),
                eq(aiEnhancements.userId, userId),
            ),
        )
        .where(and(...conditions))
        .orderBy(desc(recordings.updatedAt), desc(recordings.id))
        .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const last = pageRows.at(-1);

    return {
        data: pageRows.map((row) =>
            serializeRecording(row.recording, row.device, {
                hasTranscription: Boolean(row.hasTranscript),
                hasSummary: Boolean(row.enhancement),
            }),
        ),
        next_cursor:
            hasMore && last
                ? encodeRecordingCursor({
                      updatedAt: last.recording.updatedAt,
                      id: last.recording.id,
                  })
                : null,
        has_more: hasMore,
    };
}

/** Same payload as `GET /api/v1/recordings/[id]`, or `null` when not visible to the user. */
export function getRecordingForUser(
    userId: string,
    recordingId: string,
): Promise<V1RecordingDetail | null> {
    return getV1RecordingDetailForUser(userId, recordingId);
}

async function recordingExistsForUser(
    userId: string,
    recordingId: string,
): Promise<boolean> {
    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, recordingId),
                eq(recordings.userId, userId),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);
    return Boolean(recording);
}

/** Primary transcript, resolved like `GET /api/v1/recordings/[id]/transcript`. */
export async function getTranscriptForUser(
    userId: string,
    recordingId: string,
): Promise<RecordingLookup<V1Transcript>> {
    if (!(await recordingExistsForUser(userId, recordingId))) {
        return { status: "recording_not_found" };
    }

    const transcriptRows = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, recordingId),
                eq(transcriptions.userId, userId),
            ),
        );

    const transcript = serializeTranscript(
        resolvePrimaryTranscript(
            transcriptRows,
            await getPreferredTranscriptSource(userId),
        ),
    );
    return transcript
        ? { status: "ok", value: transcript }
        : { status: "missing" };
}

/** Summary, key points and action items for one of the user's recordings. */
export async function getSummaryForUser(
    userId: string,
    recordingId: string,
): Promise<RecordingLookup<V1Summary>> {
    if (!(await recordingExistsForUser(userId, recordingId))) {
        return { status: "recording_not_found" };
    }

    const [enhancement] = await db
        .select()
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, recordingId),
                eq(aiEnhancements.userId, userId),
            ),
        )
        .limit(1);

    const summary = serializeSummary(enhancement ?? null);
    return summary ? { status: "ok", value: summary } : { status: "missing" };
}

function buildSnippet(text: string, index: number, matchLength: number) {
    const lead = Math.max(0, Math.floor((SNIPPET_LENGTH - matchLength) / 2));
    const end = Math.min(
        text.length,
        Math.max(0, index - lead) + SNIPPET_LENGTH,
    );
    const start = Math.max(0, end - SNIPPET_LENGTH);
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "..." : ""}${body}${end < text.length ? "..." : ""}`;
}

/**
 * Case-insensitive substring search over titles and primary transcripts of
 * the user's newest {@link SEARCH_WINDOW} non-deleted recordings. Matching
 * happens in memory because titles and transcripts are encrypted at rest.
 */
export async function searchRecordingsForUser(
    userId: string,
    query: string,
    limit: number,
): Promise<RecordingSearchMatch[]> {
    const needle = query.toLowerCase();

    const candidates = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            startTime: recordings.startTime,
            duration: recordings.duration,
        })
        .from(recordings)
        .where(and(eq(recordings.userId, userId), isNull(recordings.deletedAt)))
        .orderBy(desc(recordings.startTime), desc(recordings.id))
        .limit(SEARCH_WINDOW);

    if (candidates.length === 0) return [];

    const preferredSource = await getPreferredTranscriptSource(userId);
    const matches: RecordingSearchMatch[] = [];

    for (
        let offset = 0;
        offset < candidates.length && matches.length < limit;
        offset += SEARCH_TRANSCRIPT_PAGE_SIZE
    ) {
        const page = candidates.slice(
            offset,
            offset + SEARCH_TRANSCRIPT_PAGE_SIZE,
        );
        const transcriptRows = await db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.userId, userId),
                    inArray(
                        transcriptions.recordingId,
                        page.map((candidate) => candidate.id),
                    ),
                ),
            );

        for (const candidate of page) {
            const title = decryptText(candidate.filename);
            const primary = resolvePrimaryTranscript(
                transcriptRows.filter(
                    (row) => row.recordingId === candidate.id,
                ),
                preferredSource,
            );
            const text = primary ? decryptText(primary.text) : "";

            const matchedInTitle = title.toLowerCase().includes(needle);
            const transcriptIndex = text.toLowerCase().indexOf(needle);
            if (!matchedInTitle && transcriptIndex === -1) continue;

            const matchedIn: RecordingSearchMatch["matched_in"] = [];
            if (matchedInTitle) matchedIn.push("title");
            if (transcriptIndex !== -1) matchedIn.push("transcript");

            matches.push({
                id: candidate.id,
                title,
                recorded_at: candidate.startTime.toISOString(),
                duration_ms: candidate.duration,
                matched_in: matchedIn,
                snippet:
                    transcriptIndex === -1
                        ? null
                        : buildSnippet(text, transcriptIndex, needle.length),
            });
            if (matches.length >= limit) break;
        }
    }

    return matches;
}
