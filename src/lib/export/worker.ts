import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    claimPendingExportJobs,
    completeExportJob,
    deleteExportJobRow,
    EXPORT_MAX_ATTEMPTS,
    reclaimStaleProcessingExportJobs,
    recordExportJobFailure,
    selectExpiredExportJobs,
} from "@/db/queries/export-jobs";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { sendExportReadyEmail } from "@/lib/notifications/email";
import { createStorageProvider } from "@/lib/storage/factory";
import { buildAndUploadExportArchive } from "./build-archive";

const TICK_MS = 30 * 1000;
// Archive builds are CPU/memory/IO heavier than a sync tick -- cap how
// many run per process per tick so one user's large export doesn't
// starve sync/transcription work on the same instance (hosted fairness).
const MAX_JOBS_PER_TICK = 2;
const MAX_CLEANUP_PER_TICK = 20;
// No forward progress (bytes written, or a recording finished) for this
// long means the build is genuinely stuck (hung network read, wedged
// storage call) -- abort it. This is deliberately about progress, not
// total duration: a large-but-healthy library that's still making
// steady progress is never killed for taking a while.
const STALL_TIMEOUT_MS = 5 * 60 * 1000;
// Absolute safety ceiling regardless of progress, so a pathological case
// (e.g. a library so large it never stops making *some* progress but
// never finishes in practice) still can't wedge a worker slot forever.
// Every in-process build is guaranteed to resolve/reject by this point.
const MAX_TOTAL_MS = 3 * 60 * 60 * 1000;
// If a job has been "processing" for longer than this, the process that
// claimed it almost certainly crashed or was redeployed mid-build (no
// in-process timer survives a process death to catch it another way).
// Reset it to pending so another tick picks it back up.
//
// Set safely above MAX_TOTAL_MS -- not just above the old fixed job
// timeout -- so this only ever fires for genuinely dead processes, never
// for a job that's still legitimately running toward its own internal
// ceiling. A reclaim while the original worker is still alive is made
// safe by the claim-token scoping on every write (see `claimToken` on
// the schema and `completeExportJob`/`recordExportJobFailure`), but it's
// still wasted duplicate work to avoid where possible.
const STALE_PROCESSING_MS = MAX_TOTAL_MS + 30 * 60 * 1000;

/**
 * Runs `run` under both a stall timeout (reset on every `onProgress()`
 * call) and a hard total-duration ceiling. Either one aborts `signal`
 * and rejects.
 */
function runWithStallGuard<T>(
    run: (signal: AbortSignal, onProgress: () => void) => Promise<T>,
    opts: { stallMs: number; maxTotalMs: number },
): Promise<T> {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
        let idleTimer: ReturnType<typeof setTimeout>;
        const settle = (fn: () => void) => {
            clearTimeout(idleTimer);
            clearTimeout(maxTimer);
            fn();
        };
        const maxTimer = setTimeout(() => {
            controller.abort();
            settle(() =>
                reject(
                    new Error(
                        `Export job exceeded max duration of ${opts.maxTotalMs}ms`,
                    ),
                ),
            );
        }, opts.maxTotalMs);
        const resetIdleTimer = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                controller.abort();
                settle(() =>
                    reject(
                        new Error(
                            `Export job stalled: no progress for ${opts.stallMs}ms`,
                        ),
                    ),
                );
            }, opts.stallMs);
        };
        resetIdleTimer();
        run(controller.signal, resetIdleTimer).then(
            (value) => settle(() => resolve(value)),
            (error) => settle(() => reject(error)),
        );
    });
}

async function processJob(job: {
    id: string;
    userId: string;
    claimToken: string;
}): Promise<void> {
    const storage = createStorageProvider();
    // Keyed per claim attempt (not just per job) -- a job that's
    // reclaimed as stale and re-claimed gets a fresh claimToken and
    // therefore a fresh key. That means a superseded claim can never
    // step on the winning claim's object: cleaning up `storageKey` here
    // only ever touches *this attempt's own* upload, whether it's a
    // partial from a failed build or a finished one nobody ended up
    // using because the row moved on without it.
    const storageKey = `exports/${job.userId}/${job.id}-${job.claimToken}.zip`;

    try {
        const result = await runWithStallGuard(
            (signal, onProgress) =>
                buildAndUploadExportArchive({
                    userId: job.userId,
                    storage,
                    storageKey,
                    signal,
                    onProgress,
                }),
            { stallMs: STALL_TIMEOUT_MS, maxTotalMs: MAX_TOTAL_MS },
        );

        const completed = await completeExportJob({
            jobId: job.id,
            claimToken: job.claimToken,
            storageKey,
            fileSize: result.fileSize,
            recordingCount: result.recordingCount,
        });

        if (!completed) {
            // This claim was reclaimed as stale while the build was still
            // in flight -- some other worker owns the job now (or already
            // finished it). Don't notify; the winning claim's row already
            // points at *its own* storageKey, so deleting this one only
            // discards this now-unreferenced attempt's own upload.
            console.warn(
                `[export-worker] job ${job.id} finished but its claim was superseded; discarding result`,
            );
            await storage.deleteFile(storageKey).catch(() => {});
            return;
        }

        await notifyExportReady(job.userId, job.id).catch((error) => {
            console.error(
                `[export-worker] notify failed for job ${job.id}:`,
                error,
            );
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const outcome = await recordExportJobFailure(
            job.id,
            job.claimToken,
            message,
        );
        if (outcome === null) {
            // Claim superseded -- another worker owns (or already resolved)
            // this job. Nothing to record against a claim we no longer
            // hold. Cleanup below still runs: `storageKey` is scoped to
            // *this* claim attempt, so deleting it can't affect whatever
            // the current owner has done.
            console.warn(
                `[export-worker] job ${job.id} failed but its claim was superseded; not recording`,
            );
        } else if (outcome.status === "failed") {
            console.error(
                `[export-worker] job ${job.id} failed permanently after ${outcome.attempts} attempt(s):`,
                error,
            );
        } else {
            console.warn(
                `[export-worker] job ${job.id} failed (attempt ${outcome.attempts}/${EXPORT_MAX_ATTEMPTS}), requeued:`,
                message,
            );
        }
        // Clean up any partial object left behind by a failed/aborted
        // upload. A retry gets a fresh claim token and therefore a fresh
        // key (see above), so this never collides with a subsequent
        // attempt's object.
        await storage.deleteFile(storageKey).catch(() => {});
    }
}

async function notifyExportReady(userId: string, jobId: string): Promise<void> {
    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return;
    const [row] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!row?.email) return;
    await sendExportReadyEmail({
        userId,
        email: row.email,
        jobId,
        downloadUrl: `${base}/settings?export=${jobId}#export`,
    });
}

async function cleanupExpired(): Promise<void> {
    const expired = await selectExpiredExportJobs(MAX_CLEANUP_PER_TICK);
    if (expired.length === 0) return;
    const storage = createStorageProvider();
    let cleaned = 0;
    for (const job of expired) {
        try {
            // Row deletion only happens after the storage delete
            // succeeds -- deleting the row first would permanently
            // orphan the archive object (no record left to retry
            // against) if the storage call then failed.
            await storage.deleteFile(job.storageKey);
            await deleteExportJobRow(job.id);
            cleaned += 1;
        } catch (error) {
            console.error(
                `[export-worker] cleanup deleteFile failed for job ${job.id}, will retry next tick:`,
                error,
            );
        }
    }
    if (cleaned > 0) {
        console.log(`[export-worker] cleaned up ${cleaned} expired archive(s)`);
    }
}

let started = false;
let running = false;

/** Exported for testing. */
export async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const reclaimed =
            await reclaimStaleProcessingExportJobs(STALE_PROCESSING_MS);
        if (reclaimed > 0) {
            console.log(`[export-worker] reclaimed ${reclaimed} stale job(s)`);
        }

        const jobs = await claimPendingExportJobs(MAX_JOBS_PER_TICK);
        for (const job of jobs) {
            await processJob(job);
        }

        await cleanupExpired();
    } catch (error) {
        console.error("[export-worker] tick failed:", error);
    } finally {
        running = false;
    }
}

/**
 * Start the full-data export archive worker. Runs on both hosted and
 * self-host (unlike the Plaud sync worker, this isn't hosted-only --
 * self-host users benefit from the same async, non-blocking archive
 * build). Safe to call more than once.
 */
export function startExportWorker(): void {
    if (started) return;
    started = true;
    const interval = setInterval(() => {
        void tick();
    }, TICK_MS);
    interval.unref?.();
    void tick();
}
