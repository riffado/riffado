import { sql } from "drizzle-orm";
import { db } from "@/db";

// MUST NOT select: recording filenames, transcript text, summary content.
// export_jobs itself carries none of that (status/size/count/error only),
// so this file is safe by construction as long as it stays that way.

const DAY_MS = 86_400_000;

export interface ExportJobsOverview {
    pending: number;
    processing: number;
    /** Completed jobs whose archive is still retained (not yet swept). */
    completedRetained: number;
    failedLast24h: number;
    failedLast7d: number;
    createdLast24h: number;
    createdLast7d: number;
    /** Total bytes currently sitting in storage across retained archives. */
    retainedBytes: number;
    /**
     * Jobs stuck in `processing` for longer than the worker's own
     * stale-reclaim window (30 min) would already self-heal -- this
     * flags anything the reclaim hasn't caught yet within a wider
     * window, as an early warning rather than a hard incident signal.
     */
    stuckProcessing: number;
}

export async function exportJobsOverview(): Promise<ExportJobsOverview> {
    const d1 = sql`${new Date(Date.now() - 1 * DAY_MS).toISOString()}::timestamp`;
    const d7 = sql`${new Date(Date.now() - 7 * DAY_MS).toISOString()}::timestamp`;
    const stuckCutoff = sql`${new Date(Date.now() - 45 * 60_000).toISOString()}::timestamp`;

    const [row] = await db.execute<{
        pending: number;
        processing: number;
        completed_retained: number;
        failed_24h: number;
        failed_7d: number;
        created_24h: number;
        created_7d: number;
        retained_bytes: number;
        stuck_processing: number;
    }>(sql`
        select
            count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status = 'processing')::int as processing,
            count(*) filter (
                where status = 'completed' and (expires_at is null or expires_at > now())
            )::int as completed_retained,
            count(*) filter (where status = 'failed' and completed_at >= ${d1})::int as failed_24h,
            count(*) filter (where status = 'failed' and completed_at >= ${d7})::int as failed_7d,
            count(*) filter (where created_at >= ${d1})::int as created_24h,
            count(*) filter (where created_at >= ${d7})::int as created_7d,
            coalesce(sum(file_size) filter (
                where status = 'completed' and (expires_at is null or expires_at > now())
            ), 0)::bigint as retained_bytes,
            count(*) filter (
                where status = 'processing' and started_at < ${stuckCutoff}
            )::int as stuck_processing
        from export_jobs
    `);

    return {
        pending: row?.pending ?? 0,
        processing: row?.processing ?? 0,
        completedRetained: row?.completed_retained ?? 0,
        failedLast24h: row?.failed_24h ?? 0,
        failedLast7d: row?.failed_7d ?? 0,
        createdLast24h: row?.created_24h ?? 0,
        createdLast7d: row?.created_7d ?? 0,
        retainedBytes: Number(row?.retained_bytes ?? 0),
        stuckProcessing: row?.stuck_processing ?? 0,
    };
}

export interface AdminExportJobRow {
    id: string;
    userId: string;
    userEmail: string;
    status: string;
    recordingCount: number | null;
    fileSize: number | null;
    errorMessage: string | null;
    attempts: number;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
}

export async function listRecentExportJobs(opts: {
    limit: number;
    offset: number;
    status?: string;
}): Promise<{ rows: AdminExportJobRow[]; total: number }> {
    const statusFilter = opts.status
        ? sql`and j.status = ${opts.status}`
        : sql``;

    const [countRow] = await db.execute<
        { count: number } & Record<string, unknown>
    >(sql`
        select count(*)::int as count
        from export_jobs j
        where 1=1 ${statusFilter}
    `);

    const rows = await db.execute<
        AdminExportJobRow & Record<string, unknown>
    >(sql`
        select
            j.id as "id",
            j.user_id as "userId",
            u.email as "userEmail",
            j.status as "status",
            j.recording_count as "recordingCount",
            j.file_size as "fileSize",
            j.error_message as "errorMessage",
            j.attempts as "attempts",
            j.created_at as "createdAt",
            j.started_at as "startedAt",
            j.completed_at as "completedAt",
            j.expires_at as "expiresAt"
        from export_jobs j
        join users u on u.id = j.user_id
        where 1=1 ${statusFilter}
        order by j.created_at desc
        limit ${opts.limit}
        offset ${opts.offset}
    `);

    return { rows: [...rows], total: countRow?.count ?? 0 };
}
