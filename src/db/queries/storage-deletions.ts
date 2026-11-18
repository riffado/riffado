import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { storageDeletionQueue } from "@/db/schema";

/** Where a queued storage delete came from, for operator triage. */
export type StorageDeletionSource = "account_deletion" | "export_cleanup";

/** One queued delete, claimed for a single attempt. */
export interface ClaimedStorageDeletion {
    storageKey: string;
    attempts: number;
    claimToken: string;
}

type QueueWriter = Pick<typeof db, "insert">;

/**
 * Queues storage keys whose delete failed. A key that is already queued
 * keeps its existing row. Pass a transaction as `writer` so the keys are
 * only queued if the surrounding write (e.g. the user-row delete) commits.
 */
export async function enqueueStorageDeletions(
    keys: string[],
    source: StorageDeletionSource,
    writer: QueueWriter = db,
): Promise<void> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return;
    await writer
        .insert(storageDeletionQueue)
        .values(unique.map((storageKey) => ({ storageKey, source })))
        .onConflictDoNothing({ target: storageDeletionQueue.storageKey });
}

/**
 * Atomically claims up to `limit` due deletes (`FOR UPDATE SKIP LOCKED`
 * inside one statement) and leases them for `leaseMs`: the lease pushes
 * `next_attempt_at` forward, so a worker that dies mid-attempt leaves the
 * row due again once the lease runs out instead of stranding it.
 */
export async function claimDueStorageDeletions(input: {
    limit: number;
    leaseMs: number;
}): Promise<ClaimedStorageDeletion[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntilIso = new Date(now.getTime() + input.leaseMs).toISOString();
    const result = await db.execute<{
        storage_key: string;
        attempts: number;
        claim_token: string;
    }>(sql`
        update ${storageDeletionQueue}
        set
            claim_token = gen_random_uuid()::text,
            next_attempt_at = ${leaseUntilIso}::timestamp,
            updated_at = ${nowIso}::timestamp
        where storage_key in (
            select storage_key
            from ${storageDeletionQueue}
            where status = 'pending'
              and next_attempt_at <= ${nowIso}::timestamp
            order by next_attempt_at asc, created_at asc
            limit ${input.limit}
            for update skip locked
        )
        returning storage_key, attempts, claim_token
    `);
    const rows = Array.isArray(result)
        ? result
        : ((
              result as {
                  rows: {
                      storage_key: string;
                      attempts: number;
                      claim_token: string;
                  }[];
              }
          ).rows ?? []);
    return rows.map((row) => ({
        storageKey: row.storage_key,
        attempts: row.attempts,
        claimToken: row.claim_token,
    }));
}

/** Removes a queued delete once the object is gone, scoped to the claim that deleted it. */
export async function completeStorageDeletion(input: {
    storageKey: string;
    claimToken: string;
}): Promise<boolean> {
    const rows = await db
        .delete(storageDeletionQueue)
        .where(
            and(
                eq(storageDeletionQueue.storageKey, input.storageKey),
                eq(storageDeletionQueue.claimToken, input.claimToken),
            ),
        )
        .returning({ storageKey: storageDeletionQueue.storageKey });
    return rows.length > 0;
}

/**
 * Records a failed attempt, scoped to the claim that made it. Reschedules
 * for `retryAt`, or marks the row `failed` (no further retries) once
 * `maxAttempts` is reached. Returns null when the claim no longer matches.
 */
export async function failStorageDeletion(input: {
    storageKey: string;
    claimToken: string;
    errorMessage: string;
    maxAttempts: number;
    retryAt: Date;
}): Promise<{ status: string; attempts: number } | null> {
    const retryAtIso = input.retryAt.toISOString();
    const result = await db.execute<{ status: string; attempts: number }>(sql`
        update ${storageDeletionQueue}
        set
            attempts = attempts + 1,
            status = case
                when attempts + 1 >= ${input.maxAttempts} then 'failed'
                else 'pending'
            end,
            next_attempt_at = ${retryAtIso}::timestamp,
            claim_token = null,
            last_error = ${input.errorMessage},
            updated_at = now()
        where storage_key = ${input.storageKey}
          and claim_token = ${input.claimToken}
        returning status, attempts
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { status: string; attempts: number }[] }).rows ??
          []);
    return rows[0] ?? null;
}
