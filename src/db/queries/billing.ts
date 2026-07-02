import { and, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
    billingCustomers,
    recordings,
    stripeWebhookEvents,
    subscriptions,
    users,
} from "@/db/schema";

export interface BillingCustomerRow {
    userId: string;
    stripeCustomerId: string;
    createdAt: Date;
    updatedAt: Date;
}

export async function upsertBillingCustomer(input: {
    userId: string;
    stripeCustomerId: string;
}): Promise<void> {
    await db
        .insert(billingCustomers)
        .values({
            userId: input.userId,
            stripeCustomerId: input.stripeCustomerId,
        })
        .onConflictDoUpdate({
            target: billingCustomers.userId,
            set: {
                stripeCustomerId: input.stripeCustomerId,
                updatedAt: new Date(),
            },
        });
}

export async function getBillingCustomerByUserId(
    userId: string,
): Promise<BillingCustomerRow | null> {
    const rows = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId))
        .limit(1);
    return rows[0] ?? null;
}

export async function getBillingCustomerByStripeId(
    stripeCustomerId: string,
): Promise<BillingCustomerRow | null> {
    const rows = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId))
        .limit(1);
    return rows[0] ?? null;
}

export interface SubscriptionUpsertInput {
    id: string;
    userId: string;
    stripeCustomerId: string;
    stripePriceId: string | null;
    status: string;
    amountValue: string;
    amountCurrency: string;
    interval: string;
    description: string | null;
    billingCountry: string | null;
    startDate: Date | null;
    nextPaymentAt: Date | null;
    canceledAt: Date | null;
    withdrawalWaiverAcceptedAt?: Date | null;
    metadata: unknown;
}

export async function upsertSubscription(
    input: SubscriptionUpsertInput,
): Promise<void> {
    const baseValues = {
        id: input.id,
        userId: input.userId,
        stripeCustomerId: input.stripeCustomerId,
        stripePriceId: input.stripePriceId,
        status: input.status,
        amountValue: input.amountValue,
        amountCurrency: input.amountCurrency,
        interval: input.interval,
        description: input.description,
        billingCountry: input.billingCountry,
        startDate: input.startDate,
        nextPaymentAt: input.nextPaymentAt,
        canceledAt: input.canceledAt,
        metadata: input.metadata,
    };
    const insertValues = input.withdrawalWaiverAcceptedAt
        ? {
              ...baseValues,
              withdrawalWaiverAcceptedAt: input.withdrawalWaiverAcceptedAt,
          }
        : baseValues;
    const updateValues = input.withdrawalWaiverAcceptedAt
        ? {
              ...baseValues,
              withdrawalWaiverAcceptedAt: input.withdrawalWaiverAcceptedAt,
              updatedAt: new Date(),
          }
        : { ...baseValues, updatedAt: new Date() };

    await db.insert(subscriptions).values(insertValues).onConflictDoUpdate({
        target: subscriptions.id,
        set: updateValues,
    });
}

export interface SubscriptionRow {
    id: string;
    userId: string;
    stripeCustomerId: string;
    stripePriceId: string | null;
    status: string;
    amountValue: string;
    amountCurrency: string;
    interval: string;
    description: string | null;
    billingCountry: string | null;
    startDate: Date | null;
    nextPaymentAt: Date | null;
    canceledAt: Date | null;
    withdrawalWaiverAcceptedAt: Date | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
}

export async function getSubscriptionById(
    id: string,
): Promise<SubscriptionRow | null> {
    const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
        .limit(1);
    return (rows[0] as SubscriptionRow | undefined) ?? null;
}

/**
 * Returns the user's most relevant subscription row.
 *
 * Ordering: active/pending rows first (the partial unique index guarantees
 * at most one), then the most recently updated canceled/expired row.
 */
export async function getSubscriptionByUserId(
    userId: string,
): Promise<SubscriptionRow | null> {
    const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(
            sql`case when ${subscriptions.status} in ('active','trialing','past_due') then 0 else 1 end`,
            desc(subscriptions.updatedAt),
        )
        .limit(1);
    return (rows[0] as SubscriptionRow | undefined) ?? null;
}

/** CAS: flip status from `expectedStatus` to `newStatus`. Returns true on success. */
export async function casSubscriptionStatus(input: {
    id: string;
    expectedStatus: string;
    newStatus: string;
}): Promise<boolean> {
    const result = await db
        .update(subscriptions)
        .set({ status: input.newStatus, updatedAt: new Date() })
        .where(
            and(
                eq(subscriptions.id, input.id),
                eq(subscriptions.status, input.expectedStatus),
            ),
        )
        .returning({ id: subscriptions.id });
    return result.length > 0;
}

/**
 * Authoritative plan write. `getEntitlements` reads from `users.plan`,
 * so all billing flows must call this on activation, mirror, and
 * cancellation. Touches `updatedAt` to bump cache validators.
 */
export async function setUserPlan(input: {
    userId: string;
    plan: "self_host" | "hosted_free" | "hosted_pro";
}): Promise<void> {
    await db
        .update(users)
        .set({ plan: input.plan, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
}

/**
 * Idempotently stamp `everPaidAt` on the first successful charge.
 * Subsequent calls are no-ops (`everPaidAt IS NOT NULL` guard).
 */
export async function markEverPaid(input: {
    userId: string;
    paidAt: Date;
}): Promise<void> {
    await db
        .update(users)
        .set({ everPaidAt: input.paidAt, updatedAt: new Date() })
        .where(
            and(eq(users.id, input.userId), sql`${users.everPaidAt} is null`),
        );
}

/** Idempotent founding-member stamp. No-ops if already set. */
export async function stampFoundingMember(userId: string): Promise<void> {
    await db
        .update(users)
        .set({ foundingMember: true, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.foundingMember, false)));
}

/**
 * Set the deletion timestamp. Idempotent: if a deletion is already
 * scheduled we keep the EARLIER timestamp (so a trial-end schedule isn't
 * pushed out by a later cancel event). Pass `force: true` to override.
 */
export async function scheduleAccountDeletion(input: {
    userId: string;
    scheduledAt: Date;
    force?: boolean;
}): Promise<void> {
    if (input.force) {
        await db
            .update(users)
            .set({
                accountDeletionScheduledAt: input.scheduledAt,
                updatedAt: new Date(),
            })
            .where(eq(users.id, input.userId));
        return;
    }
    await db
        .update(users)
        .set({
            accountDeletionScheduledAt: input.scheduledAt,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(users.id, input.userId),
                sql`(${users.accountDeletionScheduledAt} is null or ${users.accountDeletionScheduledAt} > ${input.scheduledAt.toISOString()}::timestamp)`,
            ),
        );
}

/** Clear any pending deletion. Called on successful reactivation. */
export async function clearAccountDeletion(userId: string): Promise<void> {
    await db
        .update(users)
        .set({ accountDeletionScheduledAt: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
}

/**
 * Find hosted_pro users whose trial window has expired and who have no
 * active Stripe subscription. These are the no-card trial signups that
 * need to be demoted + scheduled for deletion.
 *
 * Bounded + FOR UPDATE SKIP LOCKED so multiple worker processes don't
 * stomp on each other.
 */
export async function claimUsersWithExpiredTrials(limit: number): Promise<
    {
        id: string;
        createdAt: Date;
        everPaidAt: Date | null;
        planTransitionUntil: Date | null;
    }[]
> {
    const result = await db.execute<{
        id: string;
        created_at: Date;
        ever_paid_at: Date | null;
        plan_transition_until: Date | null;
    }>(sql`
        select u.id, u.created_at, u.ever_paid_at, u.plan_transition_until
        from ${users} u
        where u.plan = 'hosted_pro'
          and u.plan_transition_until is not null
          and u.plan_transition_until <= now()
          and not exists (
            select 1 from ${subscriptions} s
            where s.user_id = u.id
              and s.status in ('active', 'trialing', 'past_due')
          )
        order by u.plan_transition_until asc
        limit ${limit}
        for update of u skip locked
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: typeof result }).rows ?? []);
    return rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        everPaidAt: r.ever_paid_at,
        planTransitionUntil: r.plan_transition_until,
    }));
}

/**
 * Claim up to `limit` users whose scheduled deletion is now due, for
 * processing by the deletion worker. FOR UPDATE SKIP LOCKED for safety
 * across multiple worker processes.
 */
export async function claimUsersDueForDeletion(
    limit: number,
): Promise<string[]> {
    const result = await db.execute<{ id: string }>(sql`
        select id
        from ${users}
        where ${users.accountDeletionScheduledAt} is not null
          and ${users.accountDeletionScheduledAt} <= now()
        order by ${users.accountDeletionScheduledAt} asc
        limit ${limit}
        for update skip locked
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { id: string }[] }).rows ?? []);
    return rows.map((r) => r.id);
}

/** List a user's recording storage paths. Used by the deletion routine. */
export async function listRecordingStoragePaths(
    userId: string,
): Promise<string[]> {
    const rows = await db
        .select({ storagePath: recordings.storagePath })
        .from(recordings)
        .where(eq(recordings.userId, userId));
    return rows.map((r) => r.storagePath);
}

/** Hard-delete a user. Cascades to all FK-dependent rows. */
export async function deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
}

/**
 * Reset the Mynah-seconds counter and push the next reset point forward.
 * Conditional: only writes if `monthlyMynahGrantResetAt IS NULL OR <= now`,
 * so a parallel worker that already closed the cycle doesn't double-grant.
 * Returns true iff the row was updated.
 */
export async function resetMynahCounterIfDue(input: {
    userId: string;
    grantSeconds: number;
    nextResetAt: Date;
}): Promise<boolean> {
    const result = await db
        .update(users)
        .set({
            monthlyMynahSecondsRemaining: input.grantSeconds,
            monthlyMynahGrantResetAt: input.nextResetAt,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(users.id, input.userId),
                sql`(${users.monthlyMynahGrantResetAt} is null or ${users.monthlyMynahGrantResetAt} <= now())`,
            ),
        )
        .returning({ id: users.id });
    return result.length > 0;
}

/**
 * Atomic decrement of the per-user Mynah counter. Returns true iff
 * sufficient seconds were available AND the row was successfully
 * decremented (CAS on `remaining >= seconds`). Caller must NOT decrement
 * after the work succeeds: callers reserve here, run Mynah, and on
 * failure call `refundMynahSeconds` to restore. This pattern prevents
 * a crashed worker from leaving the counter overspent or under-spent.
 */
export async function reserveMynahSeconds(input: {
    userId: string;
    seconds: number;
}): Promise<boolean> {
    if (input.seconds <= 0) return true;
    const result = await db
        .update(users)
        .set({
            monthlyMynahSecondsRemaining: sql`${users.monthlyMynahSecondsRemaining} - ${input.seconds}`,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(users.id, input.userId),
                sql`${users.monthlyMynahSecondsRemaining} >= ${input.seconds}`,
            ),
        )
        .returning({ id: users.id });
    return result.length > 0;
}

/** Restore seconds previously reserved with `reserveMynahSeconds`. */
export async function refundMynahSeconds(input: {
    userId: string;
    seconds: number;
}): Promise<void> {
    if (input.seconds <= 0) return;
    await db
        .update(users)
        .set({
            monthlyMynahSecondsRemaining: sql`${users.monthlyMynahSecondsRemaining} + ${input.seconds}`,
            updatedAt: new Date(),
        })
        .where(eq(users.id, input.userId));
}

/** Sum of `recordings.filesize` for live (non-tombstoned) rows. Returns 0 when the user has no recordings. */
export async function getUserStorageBytes(userId: string): Promise<number> {
    const rows = await db
        .select({ total: sum(recordings.filesize) })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, userId),
                sql`${recordings.deletedAt} is null`,
            ),
        );
    const total = rows[0]?.total;
    if (total === null || total === undefined) return 0;
    const parsed =
        typeof total === "string" ? Number.parseInt(total, 10) : Number(total);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Claim up to `limit` users whose Mynah-grant reset is due (or never
 * granted). Uses `FOR UPDATE SKIP LOCKED` so parallel workers cannot
 * claim the same row. The claim takes a per-row lock for the duration
 * of the surrounding transaction in the caller; this query returns ids
 * only and the caller runs the actual grant inside its own write.
 */
export async function claimUsersDueForCycleClose(
    limit: number,
): Promise<string[]> {
    const result = await db.execute<{ id: string }>(sql`
        select id
        from ${users}
        where ${users.plan} is not null
          and (${users.monthlyMynahGrantResetAt} is null or ${users.monthlyMynahGrantResetAt} <= now())
        order by ${users.monthlyMynahGrantResetAt} asc nulls first, ${users.id} asc
        limit ${limit}
        for update skip locked
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { id: string }[] }).rows ?? []);
    return rows.map((r) => r.id);
}

/**
 * List subscriptions whose local copy hasn't been touched in
 * `staleAfterSeconds` and that aren't in a terminal state. Used by the
 * reconciliation cron to detect drift when a Stripe webhook was lost
 * or deferred. Returned rows are ordered by `updatedAt asc` so the
 * stalest get reconciled first.
 */
export async function listSubscriptionsForReconcile(input: {
    limit: number;
    staleAfterSeconds: number;
}): Promise<
    { id: string; stripeCustomerId: string; status: string; updatedAt: Date }[]
> {
    const result = await db.execute<{
        id: string;
        stripe_customer_id: string;
        status: string;
        updated_at: Date;
    }>(sql`
        select id, stripe_customer_id, status, updated_at
        from ${subscriptions}
        where ${subscriptions.status} not in ('canceled', 'incomplete_expired', 'unpaid')
          and ${subscriptions.updatedAt} < now() - (${input.staleAfterSeconds} || ' seconds')::interval
        order by ${subscriptions.updatedAt} asc
        limit ${input.limit}
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: typeof result }).rows ?? []);
    return rows.map((r) => ({
        id: r.id,
        stripeCustomerId: r.stripe_customer_id,
        status: r.status,
        updatedAt: r.updated_at,
    }));
}

/** First-write-wins claim on a Stripe webhook event. Null = duplicate. */
export async function claimWebhookDelivery(input: {
    eventId: string;
    type: string;
}): Promise<{ eventId: string } | null> {
    const inserted = await db
        .insert(stripeWebhookEvents)
        .values({
            eventId: input.eventId,
            type: input.type,
        })
        .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
        .returning({ eventId: stripeWebhookEvents.eventId });
    return inserted[0] ?? null;
}

export interface UserBillingState {
    plan: "self_host" | "hosted_free" | "hosted_pro" | null;
    planTransitionUntil: Date | null;
    monthlyMynahSecondsRemaining: number;
    monthlyMynahGrantResetAt: Date | null;
    foundingMember: boolean;
    everPaidAt: Date | null;
    accountDeletionScheduledAt: Date | null;
    createdAt: Date;
}

/** Read the user-row billing snapshot. */
export async function getUserBillingState(
    userId: string,
): Promise<UserBillingState | null> {
    const rows = await db
        .select({
            plan: users.plan,
            planTransitionUntil: users.planTransitionUntil,
            monthlyMynahSecondsRemaining: users.monthlyMynahSecondsRemaining,
            monthlyMynahGrantResetAt: users.monthlyMynahGrantResetAt,
            foundingMember: users.foundingMember,
            everPaidAt: users.everPaidAt,
            accountDeletionScheduledAt: users.accountDeletionScheduledAt,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return (rows[0] as UserBillingState | undefined) ?? null;
}

/** Existence check for the `users` row referenced by FKs in billing tables. */
export async function userExistsById(userId: string): Promise<boolean> {
    const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return rows.length > 0;
}
