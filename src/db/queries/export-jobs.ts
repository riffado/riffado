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

/** Postgres SQLSTATE for unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code;
    return code === PG_UNIQUE_VIOLATION || causeCode === PG_UNIQUE_VIOLATION;
}

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

/**
 * Inserts a new pending job. The real "one active job per user" guard is
 * the partial unique index `export_jobs_user_active_unique` (userId
 * where status in pending/processing) -- an application-level
 * check-then-insert can't be atomic against a concurrent request racing
 * the same check, so the database constraint is what actually prevents
 * duplicates. When the insert loses that race, this returns the
 * existing active job instead of throwing, so callers (POST
 * /api/backup) get the same "here's your job" response either way.
 */
export async function createExportJob(userId: string): Promise<ExportJobRow> {
    try {
        const [row] = await db
            .insert(exportJobs)
            .values({ userId, status: "pending" })
            .returning();
        return row as ExportJobRow;
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const active = await getActiveExportJobForUser(userId);
        if (active) return active;
        // Vanishingly unlikely (the conflicting job would have had to
        // complete/fail between the insert failing and this re-read),
        // but don't swallow a genuine failure into a confusing retry.
        throw error;
    }
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
 * Atomically claim up to `limit` pending jobs, flip them to
 * `processing`, and stamp each with a fresh random `claim_token` -- all
 * in a single statement (`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE
 * SKIP LOCKED)`), so two worker processes racing the same tick can never
 * both pick up the same job.
 *
 * The claim token matters beyond that race: `reclaimStaleProcessingExportJobs`
 * can reset a job that's still genuinely being processed (a long-but-healthy
 * build past the stale threshold, or a slow tick), which would otherwise let
 * two workers process the same job concurrently. Every write this worker
 * makes for the job (`completeExportJob`, `recordExportJobFailure`) is
 * scoped to this exact token, so if the job gets reclaimed out from under
 * it, its eventual write becomes a no-op instead of corrupting whatever
 * the new claim has done since.
 */
export async function claimPendingExportJobs(
    limit: number,
): Promise<{ id: string; userId: string; claimToken: string }[]> {
    const result = await db.execute<{
        id: string;
        user_id: string;
        claim_token: string;
    }>(sql`
        update ${exportJobs}
        set status = 'processing', started_at = now(), claim_token = gen_random_uuid()::text
        where id in (
            select id from ${exportJobs}
            where status = 'pending'
            order by created_at asc
            limit ${limit}
            for update skip locked
        )
        returning id, user_id, claim_token
    `);
    const rows = Array.isArray(result)
        ? result
        : ((
              result as {
                  rows: { id: string; user_id: string; claim_token: string }[];
              }
          ).rows ?? []);
    return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        claimToken: r.claim_token,
    }));
}

/**
 * Completes a job, scoped to the exact claim (`claimToken`) that did the
 * work. Returns `false` (instead of throwing) if the claim no longer
 * matches -- the job was reclaimed as stale while this worker was still
 * building it -- so the caller can log it rather than silently
 * pretending the write landed.
 */
export async function completeExportJob(input: {
    jobId: string;
    claimToken: string;
    storageKey: string;
    fileSize: number;
    recordingCount: number;
}): Promise<boolean> {
    const completedAt = new Date();
    const result = await db
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
        .where(
            and(
                eq(exportJobs.id, input.jobId),
                eq(exportJobs.claimToken, input.claimToken),
            ),
        )
        .returning({ id: exportJobs.id });
    return result.length > 0;
}

/**
 * Records a failed build attempt, scoped to the exact claim
 * (`claimToken`) that failed. If the job hasn't hit
 * `EXPORT_MAX_ATTEMPTS` yet, it's requeued to `pending` (clearing the
 * claim token so the next claim gets a fresh one) instead of being
 * marked permanently `failed` -- most failures in a multi-tenant hosted
 * environment are transient (a storage blip, a network hiccup), not a
 * durable reason the job can never succeed.
 *
 * Returns `null` if the claim token no longer matches (the job was
 * reclaimed elsewhere) -- the caller has nothing to report on a job it
 * no longer owns.
 */
export async function recordExportJobFailure(
    jobId: string,
    claimToken: string,
    errorMessage: string,
): Promise<{ status: ExportJobStatus; attempts: number } | null> {
    const [row] = await db.execute<{
        status: ExportJobStatus;
        attempts: number;
    }>(sql`
        update ${exportJobs}
        set
            attempts = attempts + 1,
            error_message = ${errorMessage},
            started_at = null,
            claim_token = case
                when attempts + 1 >= ${EXPORT_MAX_ATTEMPTS} then claim_token
                else null
            end,
            status = case
                when attempts + 1 >= ${EXPORT_MAX_ATTEMPTS} then 'failed'
                else 'pending'
            end,
            completed_at = case
                when attempts + 1 >= ${EXPORT_MAX_ATTEMPTS} then now()
                else null
            end
        where id = ${jobId} and claim_token = ${claimToken}
        returning status, attempts
    `);
    return row ?? null;
}

/**
 * Selects expired completed jobs for cleanup. Deliberately a plain
 * SELECT, not a claim-and-delete: the row must not be deleted until
 * `storage.deleteFile` has actually succeeded (see
 * `deleteExportJobRow`), otherwise a storage failure permanently orphans
 * the archive object with no record left to retry it against. A
 * duplicate select across two worker processes in the same ~30s tick
 * window is a harmless, low-cost race (worst case: one extra
 * best-effort `deleteFile` call on an already-gone object).
 */
export async function selectExpiredExportJobs(
    limit: number,
): Promise<{ id: string; storageKey: string }[]> {
    const rows = await db
        .select({ id: exportJobs.id, storageKey: exportJobs.storageKey })
        .from(exportJobs)
        .where(
            and(
                eq(exportJobs.status, "completed"),
                isNotNull(exportJobs.expiresAt),
                sql`${exportJobs.expiresAt} <= now()`,
            ),
        )
        .orderBy(exportJobs.expiresAt)
        .limit(limit);
    return rows
        .filter((r): r is { id: string; storageKey: string } => !!r.storageKey)
        .map((r) => ({ id: r.id, storageKey: r.storageKey }));
}

/** Deletes a single job row. Call only after its storage object has been successfully deleted. */
export async function deleteExportJobRow(jobId: string): Promise<void> {
    await db.delete(exportJobs).where(eq(exportJobs.id, jobId));
}

/**
 * Stuck jobs: claimed by a process that crashed mid-build (no in-process
 * timer survives a process death, so elapsed time since `started_at` is
 * the only signal available). Reset to pending and clear the claim token
 * so another tick can claim it fresh; a late write from the original
 * process, if it's not actually dead, will find its old token no longer
 * matches and no-op instead of corrupting the new claim's work.
 */
export async function reclaimStaleProcessingExportJobs(
    olderThanMs: number,
): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await db
        .update(exportJobs)
        .set({ status: "pending", startedAt: null, claimToken: null })
        .where(
            and(
                eq(exportJobs.status, "processing"),
                lte(exportJobs.startedAt, cutoff),
            ),
        )
        .returning({ id: exportJobs.id });
    return result.length;
}
