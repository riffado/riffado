import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { exportJobs } from "@/db/schema";

export type ExportJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ExportJobRow {
    id: string;
    userId: string;
    status: ExportJobStatus;
    storageKey: string | null;
    fileSize: number | null;
    recordingCount: number | null;
    errorMessage: string | null;
    attempts: number;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
}

/** How long a completed archive stays downloadable before cleanup deletes it. */
export const EXPORT_ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Minimum gap between two completed exports for the same user. A full
 * archive is a real, avoidable storage cost on hosted (audio duplicated
 * into a retained zip) -- there's no legitimate reason to rebuild one
 * more than about once a day, so this is set for cost control rather
 * than UX (the "get my data before I leave" case needs exactly one).
 */
export const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** A build attempt failing this many times in a row stops retrying and sticks as `failed`. */
export const EXPORT_MAX_ATTEMPTS = 3;

/**
 * Returns the user's currently-active job (pending/processing) if one
 * exists, without creating anything. Callers use this to decide whether
 * a new `POST /api/backup` should short-circuit to the existing job.
 */
export async function getActiveExportJobForUser(
    userId: string,
): Promise<ExportJobRow | null> {
    const [row] = await db
        .select()
        .from(exportJobs)
        .where(
            and(
                eq(exportJobs.userId, userId),
                sql`${exportJobs.status} in ('pending', 'processing')`,
            ),
        )
        .limit(1);
    return (row as ExportJobRow) ?? null;
}

/**
 * Most recent completed, still-unexpired job for the user. Used both to
 * enforce the cooldown and to hand back an existing archive instead of
 * building a redundant one.
 */
export async function getRecentCompletedExportJobForUser(
    userId: string,
): Promise<ExportJobRow | null> {
    const [row] = await db
        .select()
        .from(exportJobs)
        .where(
            and(
                eq(exportJobs.userId, userId),
                eq(exportJobs.status, "completed"),
                isNotNull(exportJobs.expiresAt),
                sql`${exportJobs.expiresAt} > now()`,
            ),
        )
        .orderBy(sql`${exportJobs.completedAt} desc`)
        .limit(1);
    return (row as ExportJobRow) ?? null;
}

export async function createExportJob(userId: string): Promise<ExportJobRow> {
    const [row] = await db
        .insert(exportJobs)
        .values({ userId, status: "pending" })
        .returning();
    return row as ExportJobRow;
}

/** Most recent jobs for a user, newest first. Used by the settings export history view. */
export async function listExportJobsForUser(
    userId: string,
    limit = 10,
): Promise<ExportJobRow[]> {
    const rows = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.userId, userId))
        .orderBy(desc(exportJobs.createdAt))
        .limit(limit);
    return rows as ExportJobRow[];
}

export async function getExportJobForUser(
    jobId: string,
    userId: string,
): Promise<ExportJobRow | null> {
    const [row] = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, jobId), eq(exportJobs.userId, userId)))
        .limit(1);
    return (row as ExportJobRow) ?? null;
}

/**
 * Atomically claim up to `limit` pending jobs and flip them to
 * `processing` in a single statement (`UPDATE ... WHERE id IN (SELECT
 * ... FOR UPDATE SKIP LOCKED)`), so two worker processes racing the same
 * tick can never both pick up the same job -- unlike a plain SELECT
 * FOR UPDATE SKIP LOCKED run outside a transaction, whose row lock is
 * released as soon as that single statement's implicit transaction
 * commits.
 */
export async function claimPendingExportJobs(
    limit: number,
): Promise<{ id: string; userId: string }[]> {
    const result = await db.execute<{ id: string; user_id: string }>(sql`
        update ${exportJobs}
        set status = 'processing', started_at = now()
        where id in (
            select id from ${exportJobs}
            where status = 'pending'
            order by created_at asc
            limit ${limit}
            for update skip locked
        )
        returning id, user_id
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { id: string; user_id: string }[] }).rows ?? []);
    return rows.map((r) => ({ id: r.id, userId: r.user_id }));
}

export async function completeExportJob(input: {
    jobId: string;
    storageKey: string;
    fileSize: number;
    recordingCount: number;
}): Promise<void> {
    const completedAt = new Date();
    await db
        .update(exportJobs)
        .set({
            status: "completed",
            storageKey: input.storageKey,
            fileSize: input.fileSize,
            recordingCount: input.recordingCount,
            completedAt,
            expiresAt: new Date(
                completedAt.getTime() + EXPORT_ARCHIVE_RETENTION_MS,
            ),
        })
        .where(eq(exportJobs.id, input.jobId));
}

/**
 * Records a failed build attempt. If the job hasn't hit
 * `EXPORT_MAX_ATTEMPTS` yet, it's requeued to `pending` (so the next
 * worker tick retries it) instead of being marked permanently `failed`
 * -- most failures in a multi-tenant hosted environment are transient
 * (a storage blip, a network hiccup), not a durable reason the job can
 * never succeed. Single atomic statement so the attempts counter can't
 * race with a concurrent claim.
 */
export async function recordExportJobFailure(
    jobId: string,
    errorMessage: string,
): Promise<{ status: ExportJobStatus; attempts: number }> {
    const [row] = await db.execute<{
        status: ExportJobStatus;
        attempts: number;
    }>(sql`
        update ${exportJobs}
        set
            attempts = attempts + 1,
            error_message = ${errorMessage},
            started_at = null,
            status = case
                when attempts + 1 >= ${EXPORT_MAX_ATTEMPTS} then 'failed'
                else 'pending'
            end,
            completed_at = case
                when attempts + 1 >= ${EXPORT_MAX_ATTEMPTS} then now()
                else null
            end
        where id = ${jobId}
        returning status, attempts
    `);
    return row ?? { status: "failed", attempts: EXPORT_MAX_ATTEMPTS };
}

/**
 * Atomically claim expired completed jobs for cleanup (delete the archive
 * from storage, then delete the row). Deleting the row inside the same
 * claim statement avoids a second process re-deleting an already-gone
 * storage object between the select and the delete.
 */
export async function claimExpiredExportJobs(
    limit: number,
): Promise<{ id: string; storageKey: string }[]> {
    const result = await db.execute<{ id: string; storage_key: string }>(sql`
        delete from ${exportJobs}
        where id in (
            select id from ${exportJobs}
            where status = 'completed'
              and expires_at is not null
              and expires_at <= now()
            order by expires_at asc
            limit ${limit}
            for update skip locked
        )
        returning id, storage_key
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { id: string; storage_key: string }[] }).rows ??
          []);
    return rows
        .filter((r) => r.storage_key)
        .map((r) => ({ id: r.id, storageKey: r.storage_key }));
}

/** Stuck jobs: claimed by a process that crashed mid-build. Reset to pending so another tick can retry. */
export async function reclaimStaleProcessingExportJobs(
    olderThanMs: number,
): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await db
        .update(exportJobs)
        .set({ status: "pending", startedAt: null })
        .where(
            and(
                eq(exportJobs.status, "processing"),
                lte(exportJobs.startedAt, cutoff),
            ),
        )
        .returning({ id: exportJobs.id });
    return result.length;
}
