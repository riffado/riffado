import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiRateLimitBuckets } from "@/db/schema";

export interface UpsertRateLimitBucketInput {
    /**
     * Already-derived bucket key. The query layer never sees raw user
     * identifiers or IPs -- callers HMAC them first via
     * `rate-limit.ts::bucketKey` so a hosted DB exfil doesn't reveal which
     * users/IPs were rate-limited.
     */
    key: string;
    /** Reference time for window comparisons. */
    now: Date;
    /** When the *new* window would expire if this row is a fresh start. */
    resetAt: Date;
}

export interface UpsertRateLimitBucketRow {
    count: number;
    resetAt: Date;
}

/**
 * Atomic fixed-window counter increment. Inserts a fresh bucket on first
 * hit; on conflict, rolls the window over when the existing bucket has
 * expired and otherwise increments the counter.
 *
 * Returns the post-write `(count, resetAt)`. Allowed/remaining math is
 * the caller's responsibility.
 *
 * postgres-js binds Date \u2192 timestamp reliably for Drizzle column-typed
 * values (`.values({...})`, `set: { updatedAt: now }`), but raw sql`...`
 * bypasses Drizzle's encoder and crashes with ERR_INVALID_ARG_TYPE
 * ("Received an instance of Date") under Bun/Next 16 when a Date sits
 * inside a `sql\`\`` template literal. Cast the ISO string explicitly so
 * postgres-js receives a string parameter and Postgres handles the
 * timestamp conversion.
 */
export async function upsertRateLimitBucket({
    key,
    now,
    resetAt,
}: UpsertRateLimitBucketInput): Promise<UpsertRateLimitBucketRow | undefined> {
    const nowIso = now.toISOString();
    const resetAtIso = resetAt.toISOString();

    const [bucket] = await db
        .insert(apiRateLimitBuckets)
        .values({
            key,
            count: 1,
            resetAt,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: apiRateLimitBuckets.key,
            set: {
                count: sql<number>`case when ${apiRateLimitBuckets.resetAt} <= ${nowIso}::timestamp then 1 else ${apiRateLimitBuckets.count} + 1 end`,
                resetAt: sql<Date>`case when ${apiRateLimitBuckets.resetAt} <= ${nowIso}::timestamp then ${resetAtIso}::timestamp else ${apiRateLimitBuckets.resetAt} end`,
                updatedAt: now,
            },
        })
        .returning({
            count: apiRateLimitBuckets.count,
            resetAt: apiRateLimitBuckets.resetAt,
        });

    return bucket;
}
