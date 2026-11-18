export type PartState = "ok" | "slow" | "down";

/** Parts judged from recorded call outcomes (plus a probe when quiet). */
export const TRAFFIC_PARTS = [
    "sign-in",
    "plaud",
    "transcription",
    "storage",
    "emails",
] as const;

/** Background jobs judged by when they last succeeded or how long they have failed. */
export const STATUS_JOBS = [
    "sync",
    "webhooks",
    "auto-transcribe",
    "billing-lapse",
] as const;

/** Every slug served at GET /api/status/<part>. */
export const STATUS_PARTS = [
    ...TRAFFIC_PARTS,
    "payments",
    ...STATUS_JOBS,
] as const;

export type TrafficPart = (typeof TRAFFIC_PARTS)[number];
export type StatusJob = (typeof STATUS_JOBS)[number];
export type StatusPart = (typeof STATUS_PARTS)[number];

/** True when `part` is a known status slug. */
export function isStatusPart(part: string): part is StatusPart {
    return (STATUS_PARTS as readonly string[]).includes(part);
}

/** True when `part` is judged from recorded traffic. */
export function isTrafficPart(part: StatusPart): part is TrafficPart {
    return (TRAFFIC_PARTS as readonly string[]).includes(part);
}

/** True when `part` is a background-job freshness check. */
export function isStatusJob(part: StatusPart): part is StatusJob {
    return (STATUS_JOBS as readonly string[]).includes(part);
}

/** Body of a 200 from GET /api/status/<part>. Kener reads `state` and `latencyMs`. */
export interface StatusResponse {
    part: StatusPart;
    state: PartState;
    /** Short machine reason, e.g. "error-rate", "slow-p95", "probe-failed", "job-stale". */
    reason: string;
    /** Latency Kener should record: window p95, probe time, or the check's own time. */
    latencyMs: number;
    /** What the verdict was judged from. */
    source: "traffic" | "probe" | "job" | "inbox";
    window?: {
        seconds: number;
        requests: number;
        errors: number;
        p95Ms: number | null;
    };
    job?: {
        lastSuccessAt: string | null;
        lastErrorAt: string | null;
        failingSince: string | null;
        slowAfterMs: number;
        downAfterMs: number;
    };
    inbox?: {
        open: number;
        oldestOpenAgeMs: number | null;
        failedLast24h: number;
    };
    /** ISO time the answer was computed. */
    checkedAt: string;
}

/** Rolling traffic window. */
export const STATUS_WINDOW_S = 5 * 60;

/**
 * Latency histogram upper bounds in ms. A call lands in the first bucket
 * whose bound it doesn't exceed; slower ones go to the overflow bucket
 * (index = LATENCY_BOUNDS_MS.length).
 */
export const LATENCY_BOUNDS_MS = [
    250, 500, 1000, 2000, 5000, 10_000, 20_000, 40_000, 60_000, 120_000,
    300_000, 600_000,
] as const;

export interface WindowCounts {
    ok: number;
    err: number;
    /** Length LATENCY_BOUNDS_MS.length + 1. */
    buckets: number[];
}

/** Zeroed counts with a full-length histogram. */
export function emptyCounts(): WindowCounts {
    return {
        ok: 0,
        err: 0,
        buckets: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
    };
}

/** Histogram index for a call that took `ms`. */
export function bucketIndex(ms: number): number {
    const i = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
    return i === -1 ? LATENCY_BOUNDS_MS.length : i;
}

/**
 * Sum counts from several minute buckets or processes. Histograms of a
 * different length (older bounds) are summed index by index and truncated
 * or padded to the current length.
 */
export function sumCounts(
    parts: readonly (
        | { ok: number; err: number; buckets: readonly number[] }
        | null
        | undefined
    )[],
): WindowCounts {
    const out = emptyCounts();
    for (const part of parts) {
        if (!part) continue;
        out.ok += Number(part.ok) || 0;
        out.err += Number(part.err) || 0;
        for (let i = 0; i < out.buckets.length; i++) {
            out.buckets[i] += Number(part.buckets[i] ?? 0) || 0;
        }
    }
    return out;
}

/**
 * 95th percentile as the upper bound of the bucket that holds it (an upper
 * estimate). Overflow returns the last bound. Null without data. With
 * `ignoreSlowest` = n, the n slowest calls are left out whenever they would
 * otherwise decide the result.
 */
export function p95(buckets: number[], ignoreSlowest = 0): number | null {
    const total = buckets.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const target = Math.max(
        1,
        Math.min(Math.ceil(total * 0.95), total - Math.max(0, ignoreSlowest)),
    );
    let seen = 0;
    for (let i = 0; i < buckets.length; i++) {
        seen += buckets[i];
        if (seen >= target) {
            return LATENCY_BOUNDS_MS[Math.min(i, LATENCY_BOUNDS_MS.length - 1)];
        }
    }
    return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1];
}

export interface Thresholds {
    /** Fewer calls than this in the window: not enough traffic, probe instead. */
    minRequests: number;
    /** Error share (0..1) at or above which the part is down. */
    downErrorRate: number;
    /** Error share at or above which it's slow. */
    slowErrorRate: number;
    /** p95 above this (ms) is slow. */
    slowP95Ms: number;
    /** p95 above this (ms) is down. */
    downP95Ms?: number;
    /** Slowest calls the verdict's p95 may leave out (see `p95`). Default 0. */
    ignoreSlowest?: number;
    /** Errors a window needs before its error rate counts. Default 1. */
    minErrors?: number;
}

export interface Verdict {
    state: PartState;
    reason: string;
}

export const SEVERITY: Record<PartState, number> = { ok: 0, slow: 1, down: 2 };

/**
 * Judge a window of real traffic. Null when there isn't enough traffic to
 * judge; the caller must then probe, never assume ok.
 */
export function classify(counts: WindowCounts, t: Thresholds): Verdict | null {
    const requests = counts.ok + counts.err;
    if (requests < t.minRequests) return null;
    const errors = counts.err >= (t.minErrors ?? 1) ? counts.err : 0;
    const errorRate = errors / requests;
    const p = p95(counts.buckets, t.ignoreSlowest ?? 0);
    if (errorRate >= t.downErrorRate) {
        return { state: "down", reason: "error-rate" };
    }
    if (t.downP95Ms !== undefined && p !== null && p > t.downP95Ms) {
        return { state: "down", reason: "slow-p95" };
    }
    if (errorRate >= t.slowErrorRate) {
        return { state: "slow", reason: "error-rate" };
    }
    if (p !== null && p > t.slowP95Ms) {
        return { state: "slow", reason: "slow-p95" };
    }
    return { state: "ok", reason: "traffic-ok" };
}

/** A probe's result: state, how long it took, and why when not ok. */
export interface ProbeResult {
    state: PartState;
    reason: string;
    latencyMs: number | null;
}

/** Build a traffic part's response. `latencyMs` falls back to `fallbackLatencyMs`. */
export function statusResponse(input: {
    part: StatusPart;
    counts: WindowCounts;
    verdict: Verdict;
    source: "traffic" | "probe";
    probeLatencyMs: number | null;
    fallbackLatencyMs: number;
    now: Date;
}): StatusResponse {
    const p = p95(input.counts.buckets);
    const latency = input.source === "probe" ? input.probeLatencyMs : p;
    return {
        part: input.part,
        state: input.verdict.state,
        reason: input.verdict.reason,
        latencyMs: latency ?? input.fallbackLatencyMs,
        source: input.source,
        window: {
            seconds: STATUS_WINDOW_S,
            requests: input.counts.ok + input.counts.err,
            errors: input.counts.err,
            p95Ms: p,
        },
        checkedAt: input.now.toISOString(),
    };
}
