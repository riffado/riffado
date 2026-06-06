import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    archiveCategoryAssignments,
    recordings,
    transcriptions,
    aiEnhancements,
} from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { apiHandler } from "@/lib/errors";

/**
 * GET /api/archive/recordings
 * Returns all archived (non-deleted) recordings for the current user,
 * with their category ids, transcript presence, and summary presence.
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const userId = session.user.id;

    const rows = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            duration: recordings.duration,
            startTime: recordings.startTime,
            filesize: recordings.filesize,
            deviceSn: recordings.deviceSn,
            archivedAt: recordings.archivedAt,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, userId),
                isNotNull(recordings.archivedAt),
                isNull(recordings.deletedAt),
            ),
        )
        .orderBy(desc(recordings.archivedAt));

    // Decrypt filenames.
    const decrypted = rows.map((r) => {
        let filename = r.filename;
        try {
            filename = decryptText(r.filename);
        } catch {
            filename = "[Decryption Failed]";
        }
        return {
            ...r,
            filename,
            startTime: r.startTime.toISOString(),
            archivedAt: r.archivedAt?.toISOString() ?? null,
        };
    });

    const ids = decrypted.map((r) => r.id);

    // Category assignments for all archived recordings.
    const assignments =
        ids.length > 0
            ? await db
                  .select({
                      recordingId: archiveCategoryAssignments.recordingId,
                      categoryId: archiveCategoryAssignments.categoryId,
                  })
                  .from(archiveCategoryAssignments)
                  .where(eq(archiveCategoryAssignments.userId, userId))
            : [];

    // Transcript / summary presence.
    const transcriptRows =
        ids.length > 0
            ? await db
                  .select({ recordingId: transcriptions.recordingId })
                  .from(transcriptions)
                  .where(eq(transcriptions.userId, userId))
            : [];

    const summaryRows =
        ids.length > 0
            ? await db
                  .select({ recordingId: aiEnhancements.recordingId })
                  .from(aiEnhancements)
                  .where(
                      and(
                          eq(aiEnhancements.userId, userId),
                          isNotNull(aiEnhancements.summary),
                      ),
                  )
            : [];

    const transcriptSet = new Set(transcriptRows.map((t) => t.recordingId));
    const summarySet = new Set(summaryRows.map((s) => s.recordingId));

    // Build a map: recordingId → categoryId[]
    const categoryMap = new Map<string, string[]>();
    for (const a of assignments) {
        const arr = categoryMap.get(a.recordingId) ?? [];
        arr.push(a.categoryId);
        categoryMap.set(a.recordingId, arr);
    }

    const result = decrypted.map((r) => ({
        ...r,
        categoryIds: categoryMap.get(r.id) ?? [],
        hasTranscript: transcriptSet.has(r.id),
        hasSummary: summarySet.has(r.id),
    }));

    return NextResponse.json({ recordings: result });
});
