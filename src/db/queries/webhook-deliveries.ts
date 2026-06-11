import { and, eq, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";

/**
 * Fair-share parameters for the delivery worker. Per-user cap prevents one
 * noisy account from starving everyone else's queue (hosted invariant);
 * total cap bounds per-tick work so a single tick can't OOM under burst.
 */
const DELIVERY_LIMIT = 50;
const PER_USER_DELIVERY_LIMIT = 10;
/**
 * How long a "processing" claim is held before another worker may reclaim
 * it. Must comfortably exceed the worst-case HTTP timeout plus any TCP
 * handshake and DNS overhead in `postWebhookRequest`. 15 minutes is well
 * above the 10s request timeout and gives Sentry-visible headroom.
 */
const PROCESSING_LEASE_MS = 15 * 60_000;

type QueryResultRows<T> = T[] | { rows: T[] };
type CandidateDeliveryRow = { id: string };

export type ClaimedDelivery = {
    delivery: typeof webhookDeliveries.$inferSelect;
    endpoint: typeof webhookEndpoints.$inferSelect;
};

function rowsFromQueryResult<T>(result: QueryResultRows<T>): T[] {
    return Array.isArray(result) ? result : result.rows;
}

function dueDeliveryPredicate(now: Date): SQL {
    return or(
        and(
            eq(webhookDeliveries.status, "pending"),
            lte(webhookDeliveries.nextAttemptAt, now),
        ),
        and(
            eq(webhookDeliveries.status, "processing"),
            lte(webhookDeliveries.nextAttemptAt, now),
        ),
    ) as SQL;
}

/**
 * Two-phase atomic claim:
 *   1. Pick up to `DELIVERY_LIMIT` delivery IDs that are due and fair
 *      (no more than `PER_USER_DELIVERY_LIMIT` per user).
 *   2. Conditionally flip them to `processing` with a lease expiry,
 *      requiring the row to still be due and the endpoint still enabled.
 *
 * Step 2 returns only the rows we actually won, so concurrent workers can
 * race safely. Returned in the original fair-share ordering so worker
 * iteration is predictable.
 */
export async function claimDueWebhookDeliveries(): Promise<ClaimedDelivery[]> {
    const now = new Date();
    // postgres-js binds Date → timestamp parameters reliably when the
    // Date sits behind a Drizzle column predicate, but raw sql`...` with
    // Date placeholders crashes under Bun/Next 16 with
    // ERR_INVALID_ARG_TYPE ("Received an instance of Date"). Cast the
    // ISO string explicitly to `timestamp` to match the column type
    // (`webhookDeliveries.nextAttemptAt` is `timestamp`, not
    // `timestamptz`); using `::timestamptz` would force a timezone
    // conversion on every comparison and skew the due window in any
    // non-UTC server timezone.
    const nowParam = sql`${now.toISOString()}::timestamp`;

    const candidateResult = await db.execute(sql`
        select id
        from (
            select
                ${webhookDeliveries.id} as id,
                ${webhookDeliveries.nextAttemptAt} as next_attempt_at,
                row_number() over (
                    partition by ${webhookDeliveries.userId}
                    order by ${webhookDeliveries.nextAttemptAt} asc, ${webhookDeliveries.id} asc
                ) as user_rank
            from ${webhookDeliveries}
            inner join ${webhookEndpoints}
                on ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
            where (
                (${webhookDeliveries.status} = 'pending' and ${webhookDeliveries.nextAttemptAt} <= ${nowParam})
                or (${webhookDeliveries.status} = 'processing' and ${webhookDeliveries.nextAttemptAt} <= ${nowParam})
            )
            and ${webhookEndpoints.enabled} = true
        ) ranked_deliveries
        where user_rank <= ${PER_USER_DELIVERY_LIMIT}
        order by next_attempt_at asc, id asc
        limit ${DELIVERY_LIMIT}
    `);

    const candidateRows = rowsFromQueryResult(
        candidateResult as unknown as QueryResultRows<CandidateDeliveryRow>,
    );

    if (candidateRows.length === 0) return [];

    const ids = candidateRows.map((row) => row.id);
    const claimExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);
    const claimedRows = await db
        .update(webhookDeliveries)
        .set({
            status: "processing",
            nextAttemptAt: claimExpiresAt,
            updatedAt: now,
        })
        .where(
            and(
                inArray(webhookDeliveries.id, ids),
                dueDeliveryPredicate(now),
                sql`exists (
                    select 1
                    from ${webhookEndpoints}
                    where ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
                    and ${webhookEndpoints.enabled} = true
                )`,
            ),
        )
        .returning({ id: webhookDeliveries.id });

    const claimedIds = new Set(claimedRows.map((row) => row.id));
    if (claimedIds.size === 0) return [];

    const rows = await db
        .select({
            delivery: webhookDeliveries,
            endpoint: webhookEndpoints,
        })
        .from(webhookDeliveries)
        .innerJoin(
            webhookEndpoints,
            eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        )
        .where(
            and(
                inArray(webhookDeliveries.id, Array.from(claimedIds)),
                eq(webhookEndpoints.enabled, true),
            ),
        );

    const order = new Map(ids.map((id, index) => [id, index]));
    return rows.sort((a, b) => {
        return (
            (order.get(a.delivery.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.delivery.id) ?? Number.MAX_SAFE_INTEGER)
        );
    });
}

/**
 * Re-fetch a claimed (delivery, endpoint) pair, asserting all of:
 *   - delivery is still in `processing` state (we still own the lease),
 *   - endpoint is still enabled (user didn't disable mid-flight),
 *   - delivery.userId / endpoint.userId still line up (defence in depth).
 *
 * Returns null when any of those drift, so the worker can release the
 * claim instead of POSTing to a stale target.
 */
export async function reloadClaimedDeliveryForSend(
    claimed: ClaimedDelivery,
): Promise<ClaimedDelivery | null> {
    const [row] = await db
        .select({
            delivery: webhookDeliveries,
            endpoint: webhookEndpoints,
        })
        .from(webhookDeliveries)
        .innerJoin(
            webhookEndpoints,
            eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        )
        .where(
            and(
                eq(webhookDeliveries.id, claimed.delivery.id),
                eq(webhookDeliveries.userId, claimed.delivery.userId),
                eq(webhookDeliveries.endpointId, claimed.endpoint.id),
                eq(webhookDeliveries.status, "processing"),
                eq(webhookEndpoints.id, claimed.endpoint.id),
                eq(webhookEndpoints.userId, claimed.endpoint.userId),
                eq(webhookEndpoints.enabled, true),
            ),
        )
        .limit(1);

    return row ?? null;
}

/**
 * Release a `processing` claim back to `pending` with `nextAttemptAt =
 * now`, so another worker can pick it up immediately. Used when the worker
 * decides not to POST (e.g. endpoint disabled mid-flight).
 *
 * userId is asserted so a bug in the worker can't bleed a release across
 * users -- the hosted multi-tenancy invariant applies even here.
 */
export async function releaseClaimedDelivery(
    delivery: typeof webhookDeliveries.$inferSelect,
): Promise<void> {
    const now = new Date();
    await db
        .update(webhookDeliveries)
        .set({
            status: "pending",
            nextAttemptAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(webhookDeliveries.id, delivery.id),
                eq(webhookDeliveries.userId, delivery.userId),
                eq(webhookDeliveries.status, "processing"),
            ),
        );
}
