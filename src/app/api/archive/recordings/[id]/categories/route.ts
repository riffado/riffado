import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { archiveCategories, archiveCategoryAssignments } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/archive/recordings/[id]/categories
 * Replace the full set of categories for a recording.
 * Body: { categoryIds: string[] }
 */
export const PUT = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id: recordingId } = await (context as IdContext).params;
    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));
    const categoryIds: string[] = Array.isArray(body.categoryIds)
        ? body.categoryIds.filter((x: unknown) => typeof x === "string")
        : [];

    // Verify all supplied category ids belong to this user.
    if (categoryIds.length > 0) {
        const owned = await db
            .select({ id: archiveCategories.id })
            .from(archiveCategories)
            .where(eq(archiveCategories.userId, userId));
        const ownedSet = new Set(owned.map((c) => c.id));
        const invalid = categoryIds.filter((cid) => !ownedSet.has(cid));
        if (invalid.length > 0) {
            throw new AppError(
                ErrorCode.FORBIDDEN,
                "One or more category ids are invalid",
                403,
            );
        }
    }

    await db.transaction(async (tx) => {
        // Delete existing assignments for this recording.
        await tx
            .delete(archiveCategoryAssignments)
            .where(
                and(
                    eq(archiveCategoryAssignments.recordingId, recordingId),
                    eq(archiveCategoryAssignments.userId, userId),
                ),
            );

        // Insert new set.
        if (categoryIds.length > 0) {
            await tx.insert(archiveCategoryAssignments).values(
                categoryIds.map((categoryId) => ({
                    recordingId,
                    categoryId,
                    userId,
                })),
            );
        }
    });

    return NextResponse.json({ success: true, categoryIds });
});
