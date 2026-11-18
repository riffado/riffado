import {
    bucketIndex,
    emptyCounts,
    type StatusJob,
    type TrafficPart,
    type WindowCounts,
} from "./types";

/** How a recorded call counts: "ignore" records nothing (e.g. a user's dead token). */
export type CallOutcome = "ok" | "error" | "ignore";

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** One process's unflushed counts for one part and minute. */
export interface PendingBucket {
    part: TrafficPart;
    minute: Date;
    counts: WindowCounts;
}

/** One process's unflushed outcomes for one job. */
export interface PendingJobRun {
    job: StatusJob;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    /** First failure after the last success seen here; null when the last outcome was a success. */
    failingFrom: Date | null;
}

interface RecorderStore {
    enabled: boolean;
    buckets: Map<string, PendingBucket>;
    jobs: Map<StatusJob, PendingJobRun>;
}

const STORE_KEY = "__riffadoStatusRecorder";
const MAX_PENDING_MINUTES = 15;

type GlobalWithStore = typeof globalThis & {
    [STORE_KEY]?: RecorderStore;
};

function store(): RecorderStore {
    const g = globalThis as GlobalWithStore;
    let current = g[STORE_KEY];
    if (!current) {
        current = { enabled: false, buckets: new Map(), jobs: new Map() };
        g[STORE_KEY] = current;
    }
    return current;
}

/**
 * True once `startStatusRecorder()` has switched recording on (only when
 * STATUS_TOKEN is set); every recorder is a no-op otherwise.
 */
export function isStatusEnabled(): boolean {
    return store().enabled;
}

/** Switch recording on or off for this process. Called by `startStatusRecorder()`. */
export function setStatusRecordingEnabled(enabled: boolean): void {
    store().enabled = enabled;
}

function minuteOf(nowMs: number): Date {
    return new Date(Math.floor(nowMs / 60_000) * 60_000);
}

function dropStaleMinutes(buckets: Map<string, PendingBucket>, nowMs: number) {
    const cutoff = nowMs - MAX_PENDING_MINUTES * 60_000;
    for (const [key, bucket] of buckets) {
        if (bucket.minute.getTime() < cutoff) buckets.delete(key);
    }
}

/**
 * Count one call for `part` in this process's current minute bucket.
 * Never throws; a no-op when status checks are not configured.
 */
export function recordOutcome(
    part: TrafficPart,
    ok: boolean,
    ms: number,
    nowMs: number = Date.now(),
): void {
    if (!isStatusEnabled()) return;
    try {
        const minute = minuteOf(nowMs);
        const key = `${part}:${minute.getTime()}`;
        const { buckets } = store();
        let bucket = buckets.get(key);
        if (!bucket) {
            dropStaleMinutes(buckets, nowMs);
            bucket = { part, minute, counts: emptyCounts() };
            buckets.set(key, bucket);
        }
        if (ok) bucket.counts.ok += 1;
        else bucket.counts.err += 1;
        bucket.counts.buckets[bucketIndex(Math.max(0, ms))] += 1;
    } catch {
        return;
    }
}

/**
 * Run `run`, time it, and record the outcome `judge` assigns for `part`.
 * The result or error passes through unchanged; recording never affects the
 * call. Without STATUS_TOKEN this is a plain call.
 */
export async function trackCall<T>(
    part: TrafficPart,
    run: () => Promise<T>,
    judge: (settled: Settled<T>) => CallOutcome,
): Promise<T> {
    if (!isStatusEnabled()) return run();
    const start = performance.now();
    let settled: Settled<T>;
    try {
        settled = { ok: true, value: await run() };
    } catch (error) {
        settled = { ok: false, error };
    }
    let outcome: CallOutcome = settled.ok ? "ok" : "error";
    try {
        outcome = judge(settled);
    } catch {
        outcome = settled.ok ? "ok" : "error";
    }
    if (outcome !== "ignore") {
        recordOutcome(part, outcome === "ok", performance.now() - start);
    }
    if (!settled.ok) throw settled.error;
    return settled.value;
}

function recordJob(job: StatusJob, success: boolean, now: Date): void {
    if (!isStatusEnabled()) return;
    try {
        const { jobs } = store();
        const current = jobs.get(job) ?? {
            job,
            lastSuccessAt: null,
            lastErrorAt: null,
            failingFrom: null,
        };
        if (success) {
            current.lastSuccessAt = now;
            current.failingFrom = null;
        } else {
            current.lastErrorAt = now;
            current.failingFrom = current.failingFrom ?? now;
        }
        jobs.set(job, current);
    } catch {
        return;
    }
}

/** Note that `job` completed a run (or had nothing to do). Never throws. */
export function recordJobSuccess(job: StatusJob, now: Date = new Date()): void {
    recordJob(job, true, now);
}

/** Note that a run of `job` failed. Never throws. */
export function recordJobFailure(job: StatusJob, now: Date = new Date()): void {
    recordJob(job, false, now);
}

/** Take and clear everything this process has recorded since the last drain. */
export function drainPending(): {
    buckets: PendingBucket[];
    jobs: PendingJobRun[];
} {
    const current = store();
    const buckets = [...current.buckets.values()];
    const jobs = [...current.jobs.values()];
    current.buckets.clear();
    current.jobs.clear();
    return { buckets, jobs };
}

/** Test-only: drop all pending state. */
export function resetStatusRecorderForTests(): void {
    const current = store();
    current.buckets.clear();
    current.jobs.clear();
}
