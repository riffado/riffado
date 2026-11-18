import {
    addStatusBucketCounts,
    mergeStatusJobRun,
    pruneStatusBuckets,
} from "@/db/queries/status";
import { env } from "@/lib/env";
import { drainPending, setStatusRecordingEnabled } from "./record";

const FLUSH_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const BUCKET_RETENTION_MS = 24 * 60 * 60_000;

const STARTED_KEY = "__riffadoStatusFlusherStarted";

type GlobalWithFlag = typeof globalThis & { [STARTED_KEY]?: boolean };

let lastPruneAt = 0;

/**
 * Write everything this process recorded since the last flush to Postgres
 * and prune old minute buckets about once an hour. Failed writes are
 * dropped (logged), never retried, so a database outage can't grow memory.
 */
export async function flushStatusRecorder(
    now: Date = new Date(),
): Promise<void> {
    const { buckets, jobs } = drainPending();
    for (const bucket of buckets) {
        try {
            await addStatusBucketCounts({
                part: bucket.part,
                minute: bucket.minute,
                ok: bucket.counts.ok,
                err: bucket.counts.err,
                latencyBuckets: bucket.counts.buckets,
            });
        } catch (error) {
            console.warn(
                "[status] bucket flush failed:",
                error instanceof Error ? error.message : error,
            );
        }
    }
    for (const job of jobs) {
        try {
            await mergeStatusJobRun(job);
        } catch (error) {
            console.warn(
                "[status] job flush failed:",
                error instanceof Error ? error.message : error,
            );
        }
    }
    if (now.getTime() - lastPruneAt >= PRUNE_INTERVAL_MS) {
        lastPruneAt = now.getTime();
        try {
            await pruneStatusBuckets(
                new Date(now.getTime() - BUCKET_RETENTION_MS),
            );
        } catch (error) {
            console.warn(
                "[status] bucket prune failed:",
                error instanceof Error ? error.message : error,
            );
        }
    }
}

/**
 * Switch status recording on for this process and start the once-a-minute
 * flush. No-op unless STATUS_TOKEN is set, so recording stays off (and
 * hot paths stay plain calls) everywhere else; safe to call more than once.
 */
export function startStatusRecorder(): void {
    if (!env.STATUS_TOKEN) return;
    setStatusRecordingEnabled(true);
    const g = globalThis as GlobalWithFlag;
    if (g[STARTED_KEY]) return;
    g[STARTED_KEY] = true;
    let flushing = false;
    const interval = setInterval(() => {
        if (flushing) return;
        flushing = true;
        void flushStatusRecorder().finally(() => {
            flushing = false;
        });
    }, FLUSH_INTERVAL_MS);
    interval.unref?.();
}
