import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

// GET - Get storage usage and info
export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const storageType = env.DEFAULT_STORAGE_TYPE;

        // Calculate storage usage
        const userRecordings = await db
            .select({ filesize: recordings.filesize })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            );

        const totalSize = userRecordings.reduce(
            (sum, r) => sum + r.filesize,
            0,
        );
        const totalRecordings = userRecordings.length;

        return NextResponse.json({
            storageType,
            totalSize,
            totalRecordings,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        });
    } catch (error) {
        console.error("Error fetching storage info:", error);
        return NextResponse.json(
            { error: "Failed to fetch storage info" },
            { status: 500 },
        );
    }
}
