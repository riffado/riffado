import type {
    StatusJobRunRow,
    StripeInboxHealthRow,
} from "@/db/queries/status";
import { env } from "@/lib/env";
import { SEVERITY, type StatusJob, type Verdict } from "./types";

/**
 * How a job is judged. "loop": a timer-driven job that records a success
 * every run, even with nothing to do; slow/down when the last success is
 * older than the thresholds. "event": runs only when there is work, so a
 * quiet job is fine; slow/down when it has failed continuously for longer
 * than the thresholds.
 */
export interface JobPolicy {
    kind: "loop" | "event";
    slowAfterMs: number;
    downAfterMs: number;
}

const MINUTE_MS = 60_000;

/** Thresholds per job, derived from each job's tick interval. */
export function jobPolicy(job: StatusJob): JobPolicy {
    switch (job) {
        case "sync":
            return {
                kind: "loop",
                slowAfterMs: 3 * env.BACKGROUND_SYNC_INTERVAL_MS,
                downAfterMs: 6 * env.BACKGROUND_SYNC_INTERVAL_MS,
            };
        case "webhooks":
            return {
                kind: "loop",
                slowAfterMs: 5 * MINUTE_MS,
                downAfterMs: 15 * MINUTE_MS,
            };
        case "billing-lapse":
            return {
                kind: "loop",
                slowAfterMs: 20 * MINUTE_MS,
                downAfterMs: 45 * MINUTE_MS,
            };
        case "auto-transcribe":
            return {
                kind: "event",
                slowAfterMs: 30 * MINUTE_MS,
                downAfterMs: 90 * MINUTE_MS,
            };
    }
}

/** Pure freshness rule for one job (see `JobPolicy`). */
export function judgeJob(
    row: StatusJobRunRow | null,
    policy: JobPolicy,
    now: Date,
): Verdict {
    if (policy.kind === "loop") {
        if (!row?.lastSuccessAt) {
            return { state: "down", reason: "job-never-succeeded" };
        }
        const age = now.getTime() - row.lastSuccessAt.getTime();
        if (age > policy.downAfterMs)
            return { state: "down", reason: "job-stale" };
        if (age > policy.slowAfterMs)
            return { state: "slow", reason: "job-stale" };
        return { state: "ok", reason: "job-fresh" };
    }

    if (!row || (!row.lastSuccessAt && !row.lastErrorAt)) {
        return { state: "ok", reason: "job-idle" };
    }
    if (!row.failingSince) return { state: "ok", reason: "job-ok" };
    const streak = now.getTime() - row.failingSince.getTime();
    if (streak > policy.downAfterMs) {
        return { state: "down", reason: "job-failing" };
    }
    if (streak > policy.slowAfterMs) {
        return { state: "slow", reason: "job-failing" };
    }
    return { state: "ok", reason: "job-recent-errors" };
}

/** Oldest unfinished Stripe event older than this: payments slow (the billing worker drains the inbox every 5 minutes). */
export const INBOX_SLOW_AFTER_MS = 15 * MINUTE_MS;
/** Oldest unfinished Stripe event older than this: payments down. */
export const INBOX_DOWN_AFTER_MS = 30 * MINUTE_MS;

/**
 * Pure rule for the Stripe webhook inbox: slow/down by the age of the
 * oldest pending or processing event, at least slow when an event failed
 * permanently within the lookback.
 */
export function judgeInbox(health: StripeInboxHealthRow, now: Date): Verdict {
    const age = health.oldestOpenAt
        ? now.getTime() - health.oldestOpenAt.getTime()
        : null;
    let verdict: Verdict = { state: "ok", reason: "inbox-ok" };
    if (age !== null && age > INBOX_DOWN_AFTER_MS) {
        verdict = { state: "down", reason: "inbox-backlog" };
    } else if (age !== null && age > INBOX_SLOW_AFTER_MS) {
        verdict = { state: "slow", reason: "inbox-backlog" };
    }
    if (health.failedSince > 0 && SEVERITY[verdict.state] < SEVERITY.slow) {
        verdict = { state: "slow", reason: "inbox-failed" };
    }
    return verdict;
}
