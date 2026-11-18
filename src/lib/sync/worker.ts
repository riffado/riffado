import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, users } from "@/db/schema";
import { env } from "@/lib/env";
import { captureServerException } from "@/lib/posthog-server";
import { recordJobFailure, recordJobSuccess } from "@/lib/status/record";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

// ponytail: skip users synced in the last 4 min -- they likely just client-synced
const STALE_THRESHOLD_MS = 4 * 60 * 1000;
const MAX_USERS_PER_TICK = 20;

/**
 * Claim users due for a server-side sync tick.
 *
 * On hosted, only `hosted_pro` users are eligible -- background sync is a
 * paid-plan perk there, and `hosted_free`/lapsed accounts are read-only
 * (enforced separately by `isHostedLockedOut` inside `syncRecordingsForUser`).
 * On self-host, `users.plan` is always NULL (there's no billing concept), so
 * every user with a Plaud connection is eligible -- self-host has no tiers
 * to gate on, and unattended background sync is the whole point of running
 * the container without a browser open (#159).
 *
 * Exported for testing.
 */
export async function claimUsersForSync(): Promise<string[]> {
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

    const conditions = [
        isNull(users.suspendedAt),
        or(
            isNull(plaudConnections.lastSync),
            lt(plaudConnections.lastSync, staleThreshold),
        ),
    ];
    if (env.IS_HOSTED) {
        conditions.push(eq(users.plan, "hosted_pro"));
    }

    const rows = await db
        .select({ userId: plaudConnections.userId })
        .from(plaudConnections)
        .innerJoin(users, eq(users.id, plaudConnections.userId))
        .where(and(...conditions))
        // Oldest/never-synced first (NULLS FIRST is Postgres's default for
        // ASC) so a large eligible pool cycles through everyone instead of
        // the same MAX_USERS_PER_TICK subset winning every tick.
        .orderBy(asc(plaudConnections.lastSync))
        .limit(MAX_USERS_PER_TICK);

    return rows.map((r) => r.userId);
}

async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const userIds = await claimUsersForSync();
        if (userIds.length === 0) {
            recordJobSuccess("sync");
            return;
        }

        let synced = 0;
        let errors = 0;
        for (const userId of userIds) {
            try {
                await syncRecordingsForUser(userId, "background");
                synced++;
                recordJobSuccess("sync");
            } catch (error) {
                errors++;
                console.error(
                    `[background-sync] failed for user ${userId}:`,
                    error,
                );
                captureServerException(error, {
                    source: "worker:sync",
                    distinctId: userId,
                });
            }
        }

        if (synced > 0 || errors > 0) {
            console.log(`[background-sync] synced=${synced} errors=${errors}`);
        }
        if (synced === 0) recordJobFailure("sync");
    } catch (error) {
        recordJobFailure("sync");
        console.error("[background-sync] tick failed:", error);
        captureServerException(error, { source: "worker:sync" });
    } finally {
        running = false;
    }
}

let started = false;
let running = false;

/**
 * Start the server-side background sync worker. Runs on both hosted (Pro
 * users only) and self-host (all users), syncing recordings independently of
 * any open browser tab or the client-side `useAutoSync` polling. Tick
 * interval is configurable via `BACKGROUND_SYNC_INTERVAL_MS` (default 5
 * min); the whole worker can be disabled via `BACKGROUND_SYNC_ENABLED=false`.
 * Safe to call more than once.
 */
export function startBackgroundSyncWorker(): void {
    if (started) return;
    if (!env.BACKGROUND_SYNC_ENABLED) return;
    started = true;
    const interval = setInterval(() => {
        void tick();
    }, env.BACKGROUND_SYNC_INTERVAL_MS);
    interval.unref?.();
    setTimeout(() => void tick(), 30_000);
}
