import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
    statusJobRuns,
    statusMinuteBuckets,
    stripeWebhookEvents,
} from "@/db/schema";

/**
 * Add one process's counts for `(part, minute)` to the shared bucket.
 * Counters and histogram cells are summed, so several processes flushing
 * the same minute end up with the total.
 */
export async function addStatusBucketCounts(input: {
    part: string;
    minute: Date;
    ok: number;
    err: number;
    latencyBuckets: number[];
}): Promise<void> {
    const t = statusMinuteBuckets;
    await db
        .insert(t)
        .values({
            part: input.part,
            minute: input.minute,
            ok: input.ok,
            err: input.err,
            latencyBuckets: input.latencyBuckets,
        })
        .onConflictDoUpdate({
            target: [t.part, t.minute],
            set: {
                ok: sql`${t.ok} + excluded.ok`,
                err: sql`${t.err} + excluded.err`,
                latencyBuckets: sql`array(
                    select coalesce(a, 0) + coalesce(b, 0)
                    from unnest(${t.latencyBuckets}, excluded.latency_buckets) with ordinality as u(a, b, i)
                    order by i
                )`,
                updatedAt: sql`now()`,
            },
        });
}

export interface StatusBucketRow {
    minute: Date;
    ok: number;
    err: number;
    latencyBuckets: number[];
    verdictOk: string | null;
    verdictSlow: string | null;
    verdictDown: string | null;
}

/** Minute buckets of `part` from `since` (inclusive), any order. */
export async function listStatusBuckets(
    part: string,
    since: Date,
): Promise<StatusBucketRow[]> {
    const t = statusMinuteBuckets;
    return db
        .select({
            minute: t.minute,
            ok: t.ok,
            err: t.err,
            latencyBuckets: t.latencyBuckets,
            verdictOk: t.verdictOk,
            verdictSlow: t.verdictSlow,
            verdictDown: t.verdictDown,
        })
        .from(t)
        .where(and(eq(t.part, part), gte(t.minute, since)));
}

/** Store `reason` as the raw verdict of `state` for `(part, minute)`. */
export async function setStatusMinuteVerdict(input: {
    part: string;
    minute: Date;
    state: "ok" | "slow" | "down";
    reason: string;
}): Promise<void> {
    const t = statusMinuteBuckets;
    const column =
        input.state === "ok"
            ? { verdictOk: input.reason }
            : input.state === "slow"
              ? { verdictSlow: input.reason }
              : { verdictDown: input.reason };
    await db
        .insert(t)
        .values({ part: input.part, minute: input.minute, ...column })
        .onConflictDoUpdate({
            target: [t.part, t.minute],
            set: { ...column, updatedAt: sql`now()` },
        });
}

/** Delete minute buckets older than `before`. */
export async function pruneStatusBuckets(before: Date): Promise<void> {
    await db
        .delete(statusMinuteBuckets)
        .where(lt(statusMinuteBuckets.minute, before));
}

/**
 * Merge one process's job outcomes into the shared row, independent of the
 * order processes flush in. With the merged last success and last error,
 * the job is failing only when the last error is newer than the last
 * success; the streak then starts at the earliest stored or incoming
 * streak start after that success, or at the last error when neither
 * qualifies.
 */
export async function mergeStatusJobRun(input: {
    job: string;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    failingFrom: Date | null;
}): Promise<void> {
    const t = statusJobRuns;
    await db
        .insert(t)
        .values({
            job: input.job,
            lastSuccessAt: input.lastSuccessAt,
            lastErrorAt: input.lastErrorAt,
            failingSince: input.failingFrom,
        })
        .onConflictDoUpdate({
            target: t.job,
            set: {
                lastSuccessAt: sql`greatest(${t.lastSuccessAt}, excluded.last_success_at)`,
                lastErrorAt: sql`greatest(${t.lastErrorAt}, excluded.last_error_at)`,
                failingSince: sql`case
                    when greatest(${t.lastErrorAt}, excluded.last_error_at) is null then null
                    when greatest(${t.lastSuccessAt}, excluded.last_success_at) >= greatest(${t.lastErrorAt}, excluded.last_error_at) then null
                    else coalesce(
                        least(
                            case
                                when greatest(${t.lastSuccessAt}, excluded.last_success_at) is null
                                    or ${t.failingSince} > greatest(${t.lastSuccessAt}, excluded.last_success_at)
                                then ${t.failingSince}
                            end,
                            case
                                when greatest(${t.lastSuccessAt}, excluded.last_success_at) is null
                                    or excluded.failing_since > greatest(${t.lastSuccessAt}, excluded.last_success_at)
                                then excluded.failing_since
                            end
                        ),
                        greatest(${t.lastErrorAt}, excluded.last_error_at)
                    )
                end`,
                updatedAt: sql`now()`,
            },
        });
}

export interface StatusJobRunRow {
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    failingSince: Date | null;
}

/** The shared row of `job`, or null when it never recorded anything. */
export async function getStatusJobRun(
    job: string,
): Promise<StatusJobRunRow | null> {
    const [row] = await db
        .select({
            lastSuccessAt: statusJobRuns.lastSuccessAt,
            lastErrorAt: statusJobRuns.lastErrorAt,
            failingSince: statusJobRuns.failingSince,
        })
        .from(statusJobRuns)
        .where(eq(statusJobRuns.job, job))
        .limit(1);
    return row ?? null;
}

/** Round trip to Postgres. Throws when the database is unreachable. */
export async function pingDatabase(): Promise<void> {
    await db.execute(sql`select 1`);
}

export interface StripeInboxHealthRow {
    open: number;
    oldestOpenAt: Date | null;
    failedSince: number;
}

function toDate(epochMs: number | string | null): Date | null {
    if (epochMs === null) return null;
    const ms = Number(epochMs);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Stripe webhook inbox backlog: events not yet completed (pending or
 * processing), the receipt time of the oldest, and events that failed
 * permanently since `failedSince`.
 */
export async function getStripeInboxHealth(
    failedSince: Date,
): Promise<StripeInboxHealthRow> {
    const failedSinceIso = failedSince.toISOString();
    const result = await db.execute<{
        open: number | string;
        oldest_open_ms: number | string | null;
        failed: number | string;
    }>(sql`
        select
            count(*) filter (where status in ('pending', 'processing')) as open,
            extract(epoch from min(created_at) filter (where status in ('pending', 'processing'))) * 1000 as oldest_open_ms,
            count(*) filter (where status = 'failed' and failed_at >= ${failedSinceIso}::timestamp) as failed
        from ${stripeWebhookEvents}
        where status in ('pending', 'processing')
           or (status = 'failed' and failed_at >= ${failedSinceIso}::timestamp)
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: typeof result }).rows ?? []);
    const row = rows[0];
    return {
        open: Number(row?.open ?? 0),
        oldestOpenAt: toDate(row?.oldest_open_ms ?? null),
        failedSince: Number(row?.failed ?? 0),
    };
}
