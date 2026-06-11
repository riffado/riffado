import { promises as fsp } from "node:fs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const userId = session.user.id;

    const activeRecording = and(
        eq(recordings.userId, userId),
        isNull(recordings.deletedAt),
    );

    const [totals] = await db
        .select({
            usedBytes: sql<number>`coalesce(sum(${recordings.filesize}), 0)::bigint`,
            recordingCount: sql<number>`count(*)::int`,
            totalDurationMs: sql<number>`coalesce(sum(${recordings.duration}), 0)::bigint`,
        })
        .from(recordings)
        .where(activeRecording);

    const largestRows = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            filesize: recordings.filesize,
            duration: recordings.duration,
            startTime: recordings.startTime,
        })
        .from(recordings)
        .where(activeRecording)
        .orderBy(desc(recordings.filesize))
        .limit(5);
    const largest = largestRows.map((r) => ({
        ...r,
        filename: decryptText(r.filename),
    }));

    // Disk-free is self-host + local only.
    let diskFreeBytes: number | null = null;
    let storageType: string = env.DEFAULT_STORAGE_TYPE;
    if (env.IS_HOSTED) {
        storageType = "hosted";
    } else if (env.DEFAULT_STORAGE_TYPE === "local") {
        try {
            const stat = await fsp.statfs(env.LOCAL_STORAGE_PATH);
            diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
            if (!Number.isFinite(diskFreeBytes) || diskFreeBytes < 0) {
                diskFreeBytes = null;
            }
        } catch {
            diskFreeBytes = null;
        }
    }

    return NextResponse.json({
        storageType,
        usedBytes: Number(totals?.usedBytes ?? 0),
        recordingCount: Number(totals?.recordingCount ?? 0),
        totalDurationMs: Number(totals?.totalDurationMs ?? 0),
        largest,
        diskFreeBytes,
        quotaBytes: null as number | null,
    });
});
