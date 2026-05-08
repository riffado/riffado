import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const userRecordings = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .orderBy(desc(recordings.startTime));

    return NextResponse.json({ recordings: userRecordings });
});
