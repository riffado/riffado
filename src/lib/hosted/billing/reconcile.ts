import { listSubscriptionsForReconcile } from "@/db/queries/billing";
import { mirrorSubscriptionById } from "./mirror";

const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_STALE_AFTER_SECONDS = 60 * 60;

export interface ReconcileResult {
    /** Total subscriptions inspected this run. */
    inspected: number;
    /** How many threw (counted but did not abort the run). */
    errors: number;
}

/**
 * Walk stale local subscriptions, re-mirror each from Stripe, and let
 * the upsert path correct any drift caused by a missed or out-of-order
 * webhook. Idempotent: re-mirroring a still-current subscription is a
 * no-op write at the data layer.
 *
 * Bounded per call (defaults: 50 subs, 1h staleness). Runs as part of
 * the billing worker tick so it self-throttles under load.
 */
export async function reconcileStaleSubscriptions(options?: {
    limit?: number;
    staleAfterSeconds?: number;
}): Promise<ReconcileResult> {
    const limit = options?.limit ?? DEFAULT_BATCH_LIMIT;
    const staleAfterSeconds =
        options?.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS;

    const stale = await listSubscriptionsForReconcile({
        limit,
        staleAfterSeconds,
    });

    let errors = 0;
    for (const row of stale) {
        try {
            await mirrorSubscriptionById(row.id);
        } catch (error) {
            errors += 1;
            console.error(
                `[billing-reconcile] failed to mirror subscription ${row.id}:`,
                error,
            );
        }
    }

    return { inspected: stale.length, errors };
}
