import { sql } from "drizzle-orm";
import type { db } from "@/db";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Acquire a per-user advisory lock for the duration of the current
 * transaction. Serialises concurrent Plaud connect / reconnect attempts so
 * the upsert into `plaud_connections` doesn't race with itself and produce
 * orphan rows or stomp a freshly-rotated bearer token.
 *
 * `hashtextextended(text, 0)` is Postgres's 64-bit text hash used by
 * `pg_advisory_xact_lock(bigint)`. We don't need cryptographic
 * collision-resistance here -- a hash collision would only mean two
 * unrelated users serialise on the same lock for a few hundred
 * milliseconds, which is harmless. We do need stability across processes,
 * which is exactly what advisory locks give us (and what an in-memory
 * Map does NOT, under hosted multi-process invariants).
 *
 * The `plaud_connect:` prefix scopes this lock namespace so a future
 * lock on the same userId for a different purpose doesn't deadlock with
 * this one.
 */
export async function acquirePlaudConnectLock(
    tx: DbTransaction,
    userId: string,
): Promise<void> {
    await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plaud_connect:${userId}`}, 0))`,
    );
}

/**
 * Serialises concurrent filetag writes for a user so the duplicate-name
 * check-then-insert in the filetag routes cannot race with itself.
 * Directory names are encrypted with a random IV, so a unique index on
 * the name is impossible and the check is read-before-write by nature.
 *
 * Namespaced separately from `plaud_connect:` to avoid cross-purpose
 * deadlocks. Never hold this lock across an HTTP call to Plaud — it is
 * meant for local-only (DB-only) write paths.
 */
export async function acquireFiletagWriteLock(
    tx: DbTransaction,
    userId: string,
): Promise<void> {
    await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`filetag_write:${userId}`}, 0))`,
    );
}
