import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { archiveCategories } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * GET /api/archive/categories
 * Returns all categories for the current user.
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const rows = await db
        .select()
        .from(archiveCategories)
        .where(eq(archiveCategories.userId, session.user.id))
        .orderBy(archiveCategories.sortOrder, archiveCategories.createdAt);

    return NextResponse.json({ categories: rows });
});

/**
 * POST /api/archive/categories
 * Create a new category: { name, color?, icon? }
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = await request.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
        throw new AppError(ErrorCode.INVALID_INPUT, "name is required", 400);
    }
    if (name.length > 80) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "name too long (max 80 chars)",
            400,
        );
    }

    const color =
        typeof body.color === "string" ? body.color.trim() : "gray";
    const icon =
        typeof body.icon === "string" ? body.icon.trim() || null : null;

    const [created] = await db
        .insert(archiveCategories)
        .values({
            userId: session.user.id,
            name,
            color,
            icon: icon ?? undefined,
        })
        .returning();

    return NextResponse.json({ category: created }, { status: 201 });
});
