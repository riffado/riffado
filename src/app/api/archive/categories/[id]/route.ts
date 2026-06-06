import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { archiveCategories } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

/** PATCH /api/archive/categories/[id] — rename / recolour a category. */
export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));

    const update: Partial<typeof archiveCategories.$inferInsert> = {
        updatedAt: new Date(),
    };
    if (typeof body.name === "string" && body.name.trim()) {
        update.name = body.name.trim().slice(0, 80);
    }
    if (typeof body.color === "string") {
        update.color = body.color.trim();
    }
    if (typeof body.icon === "string") {
        update.icon = body.icon.trim() || undefined;
    }

    const updated = await db
        .update(archiveCategories)
        .set(update)
        .where(
            and(
                eq(archiveCategories.id, id),
                eq(archiveCategories.userId, session.user.id),
            ),
        )
        .returning();

    if (updated.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, "Category not found", 404);
    }

    return NextResponse.json({ category: updated[0] });
});

/** DELETE /api/archive/categories/[id] — remove category (detaches from recordings). */
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    // ON DELETE CASCADE on the assignments FK handles cleanup automatically.
    const deleted = await db
        .delete(archiveCategories)
        .where(
            and(
                eq(archiveCategories.id, id),
                eq(archiveCategories.userId, session.user.id),
            ),
        )
        .returning({ id: archiveCategories.id });

    if (deleted.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, "Category not found", 404);
    }

    return NextResponse.json({ success: true });
});
