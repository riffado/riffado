import { and, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
    billingCustomers,
    foundingMemberReservations,
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

/**
 * Thrown by `upsertSubscription` when the row being written would violate
 * `subscriptions_user_id_active_unique` -- i.e. the user already has a
 * *different* subscription id in a live status. This happens when Stripe
 * webhooks for two subscriptions on the same customer arrive out of order
 * (the old one hasn't been mirrored as canceled/superseded yet). Callers
 * should re-mirror `conflictingSubscriptionId` from Stripe (the source of
 * truth) and retry.
 */
export class SubscriptionUserConflictError extends Error {
    constructor(
        readonly userId: string,
        readonly conflictingSubscriptionId: string,
    ) {
        super(
            `User ${userId} already has a live subscription (${conflictingSubscriptionId}) distinct from the one being mirrored`,
        );
        this.name = "SubscriptionUserConflictError";
    }
}

function isUniqueViolationOn(error: unknown, constraintName: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505" &&
        (error as { constraint_name?: string }).constraint_name ===
            constraintName
    );
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

    const doUpsert = () =>
        db.insert(subscriptions).values(insertValues).onConflictDoUpdate({
            target: subscriptions.id,
            set: updateValues,
        });

    // Bounded retry loop, not a single retry: a *genuine* conflict (a
    // different subscription is still live) throws immediately below --
    // no amount of looping fixes that, it needs `SubscriptionUserConflictError`
    // recovery from the caller. The loop exists only for the self-resolving
    // race (the blocking row clears between our failed insert and the
    // lookup): under concurrent webhook delivery that race can in
    // principle repeat, and a *second* unresolved unique violation must
    // not escape as the raw driver error -- which embeds the full
    // parameterized SQL statement (Stripe customer id, price id, amount)
    // and would leak into error tracking as an unhandled failure.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await doUpsert();
            return;
        } catch (error) {
            if (
                !isUniqueViolationOn(
                    error,
                    "subscriptions_user_id_active_unique",
                )
            ) {
                throw error;
            }
            const other = await getSubscriptionByUserId(input.userId);
            if (other && other.id !== input.id) {
                throw new SubscriptionUserConflictError(input.userId, other.id);
            }
            if (attempt === MAX_ATTEMPTS) {
                throw new Error(
                    `Failed to upsert subscription ${input.id} for user ${input.userId}: unique-constraint race did not resolve after ${MAX_ATTEMPTS} attempts`,
                );
            }
            // Conflicting row is gone -- the index isn't violated anymore.
            // Loop and retry rather than re-throwing.
        }
    }
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
 * Returns true only for the first write; subsequent calls are no-ops.
 */
export async function markEverPaid(input: {
    userId: string;
    paidAt: Date;
}): Promise<boolean> {
    const rows = await db
        .update(users)
        .set({ everPaidAt: input.paidAt, updatedAt: new Date() })
        .where(
            and(eq(users.id, input.userId), sql`${users.everPaidAt} is null`),
        )
        .returning({ id: users.id });
    return rows.length > 0;
}

export interface FoundingMemberAvailabilityRow {
    capacity: number;
    claimed: number;
    reserved: number;
    remaining: number;
}

export interface FoundingMemberReservationRow {
    id: string;
    userId: string | null;
    stripeCheckoutSessionId: string | null;
    stripePriceId: string;
    status: "reserved" | "consumed" | "released" | "expired";
    reservedAt: Date;
    expiresAt: Date;
    consumedAt: Date | null;
    releasedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Real-time founding monthly slot availability. Reserved Checkout sessions hold slots until Stripe confirms completion or expiry. */
export async function getFoundingMemberAvailability(
    capacity: number,
): Promise<FoundingMemberAvailabilityRow> {
    const result = await db.execute<{ claimed: number; reserved: number }>(sql`
        select
            (
                (select count(*)::int
                 from ${foundingMemberReservations}
                 where ${foundingMemberReservations.status} = 'consumed')
                +
                (select count(*)::int
                 from ${users} u
                 where (u.founding_member_claimed_at is not null or u.founding_member = true)
                   and not exists (
                       select 1
                       from ${foundingMemberReservations} consumed
                       where consumed.user_id = u.id
                         and consumed.status = 'consumed'
                   ))
            ) as claimed,
            (select count(*)::int
             from ${foundingMemberReservations}
             where ${foundingMemberReservations.status} = 'reserved') as reserved
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { claimed: number; reserved: number }[] }).rows ??
          []);
    const claimed = Number(rows[0]?.claimed ?? 0);
    const reserved = Number(rows[0]?.reserved ?? 0);
    return {
        capacity,
        claimed,
        reserved,
        remaining: Math.max(0, capacity - claimed - reserved),
    };
}

/**
 * Distinguishes the two reasons `createFoundingMemberReservation` can fail
 * to hand out a fresh slot. Callers must not treat them the same:
 * `unavailable` means "no founding price for this user, standard price is
 * correct" (silent fallback is fine); `already_reserved` means this exact
 * user already holds a `reserved` row (possibly backing a Checkout Session
 * they already paid on, or one they abandoned) that the caller must
 * resolve -- via Stripe -- before silently falling back to standard price,
 * or a genuine payment can get bumped to standard post-hoc.
 */
export type CreateFoundingMemberReservationResult =
    | { kind: "reserved"; reservation: FoundingMemberReservationRow }
    | { kind: "unavailable" }
    | {
          kind: "already_reserved";
          existing: {
              id: string;
              stripeCheckoutSessionId: string | null;
          };
      };

/**
 * Atomically reserve one founding monthly slot before issuing a Stripe Checkout Session.
 * The reservation, not a later count, authorizes use of the founding Stripe Price.
 */
export async function createFoundingMemberReservation(input: {
    userId: string;
    capacity: number;
    stripePriceId: string;
    now: Date;
    expiresAt: Date;
}): Promise<CreateFoundingMemberReservationResult> {
    return db.transaction(async (tx) => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('billing_founding_members', 0))`,
        );

        const nowIso = input.now.toISOString();
        await tx
            .update(foundingMemberReservations)
            .set({
                status: "expired",
                releasedAt: input.now,
                updatedAt: input.now,
            })
            .where(
                and(
                    eq(foundingMemberReservations.status, "reserved"),
                    sql`${foundingMemberReservations.stripeCheckoutSessionId} is null`,
                    sql`${foundingMemberReservations.expiresAt} <= ${nowIso}::timestamp`,
                ),
            );

        const [user] = await tx
            .select({
                foundingMemberClaimedAt: users.foundingMemberClaimedAt,
            })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);
        if (!user || user.foundingMemberClaimedAt !== null) {
            return { kind: "unavailable" };
        }

        const [existingReservation] = await tx
            .select({
                id: foundingMemberReservations.id,
                stripeCheckoutSessionId:
                    foundingMemberReservations.stripeCheckoutSessionId,
            })
            .from(foundingMemberReservations)
            .where(
                and(
                    eq(foundingMemberReservations.userId, input.userId),
                    eq(foundingMemberReservations.status, "reserved"),
                ),
            )
            .limit(1);
        if (existingReservation) {
            return { kind: "already_reserved", existing: existingReservation };
        }

        const countResult = await tx.execute<{
            claimed: number;
            reserved: number;
        }>(sql`
            select
                (
                    (select count(*)::int
                     from ${foundingMemberReservations}
                     where ${foundingMemberReservations.status} = 'consumed')
                    +
                    (select count(*)::int
                     from ${users} u
                     where (u.founding_member_claimed_at is not null or u.founding_member = true)
                       and not exists (
                           select 1
                           from ${foundingMemberReservations} consumed
                           where consumed.user_id = u.id
                             and consumed.status = 'consumed'
                       ))
                ) as claimed,
                (select count(*)::int
                 from ${foundingMemberReservations}
                 where ${foundingMemberReservations.status} = 'reserved') as reserved
        `);
        const countRows = Array.isArray(countResult)
            ? countResult
            : ((
                  countResult as {
                      rows: { claimed: number; reserved: number }[];
                  }
              ).rows ?? []);
        const claimed = Number(countRows[0]?.claimed ?? 0);
        const reserved = Number(countRows[0]?.reserved ?? 0);
        if (claimed + reserved >= input.capacity)
            return { kind: "unavailable" };

        const [reservation] = await tx
            .insert(foundingMemberReservations)
            .values({
                userId: input.userId,
                stripePriceId: input.stripePriceId,
                reservedAt: input.now,
                expiresAt: input.expiresAt,
                createdAt: input.now,
                updatedAt: input.now,
            })
            .returning();
        if (!reservation) {
            throw new Error(
                `Failed to insert founding reservation for user ${input.userId}`,
            );
        }
        return {
            kind: "reserved",
            reservation: reservation as FoundingMemberReservationRow,
        };
    });
}

export async function attachFoundingMemberReservationToCheckoutSession(input: {
    reservationId: string;
    checkoutSessionId: string;
}): Promise<boolean> {
    const rows = await db
        .update(foundingMemberReservations)
        .set({
            stripeCheckoutSessionId: input.checkoutSessionId,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(foundingMemberReservations.id, input.reservationId),
                eq(foundingMemberReservations.status, "reserved"),
            ),
        )
        .returning({ id: foundingMemberReservations.id });
    return rows.length > 0;
}

export async function releaseFoundingMemberReservation(input: {
    reservationId: string;
    releasedAt: Date;
}): Promise<void> {
    await db
        .update(foundingMemberReservations)
        .set({
            status: "released",
            releasedAt: input.releasedAt,
            updatedAt: input.releasedAt,
        })
        .where(
            and(
                eq(foundingMemberReservations.id, input.reservationId),
                eq(foundingMemberReservations.status, "reserved"),
            ),
        );
}

export async function expireFoundingMemberReservationByCheckoutSession(
    checkoutSessionId: string,
    expiredAt: Date,
): Promise<void> {
    await db
        .update(foundingMemberReservations)
        .set({
            status: "expired",
            releasedAt: expiredAt,
            updatedAt: expiredAt,
        })
        .where(
            and(
                eq(
                    foundingMemberReservations.stripeCheckoutSessionId,
                    checkoutSessionId,
                ),
                eq(foundingMemberReservations.status, "reserved"),
            ),
        );
}

export async function consumeFoundingMemberReservation(input: {
    reservationId: string | null;
    userId: string;
    stripePriceId: string;
    paidAt: Date;
}): Promise<boolean> {
    if (!input.reservationId) return false;
    const reservationId = input.reservationId;

    return db.transaction(async (tx) => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('billing_founding_members', 0))`,
        );

        const [reservation] = await tx
            .select()
            .from(foundingMemberReservations)
            .where(eq(foundingMemberReservations.id, reservationId))
            .limit(1);
        if (!reservation) return false;
        if (
            reservation.userId !== input.userId ||
            reservation.stripePriceId !== input.stripePriceId
        ) {
            return false;
        }
        if (reservation.status === "consumed") {
            await tx
                .update(users)
                .set({ foundingMember: true, updatedAt: new Date() })
                .where(eq(users.id, input.userId));
            return true;
        }
        if (reservation.status !== "reserved") return false;
        if (input.paidAt > reservation.expiresAt) return false;

        const [updatedUser] = await tx
            .update(users)
            .set({
                foundingMember: true,
                foundingMemberClaimedAt: input.paidAt,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(users.id, input.userId),
                    sql`${users.foundingMemberClaimedAt} is null`,
                ),
            )
            .returning({ id: users.id });
        if (!updatedUser) return false;

        await tx
            .update(foundingMemberReservations)
            .set({
                status: "consumed",
                consumedAt: input.paidAt,
                updatedAt: new Date(),
            })
            .where(eq(foundingMemberReservations.id, reservationId));
        return true;
    });
}

export async function expireUnattachedFoundingMemberReservations(
    now: Date,
): Promise<void> {
    const nowIso = now.toISOString();
    await db
        .update(foundingMemberReservations)
        .set({ status: "expired", releasedAt: now, updatedAt: now })
        .where(
            and(
                eq(foundingMemberReservations.status, "reserved"),
                sql`${foundingMemberReservations.stripeCheckoutSessionId} is null`,
                sql`${foundingMemberReservations.expiresAt} <= ${nowIso}::timestamp`,
            ),
        );
}

export async function listFoundingReservationsForExpiryCheck(input: {
    limit: number;
    now: Date;
}): Promise<
    { id: string; stripeCheckoutSessionId: string; expiresAt: Date }[]
> {
    const nowIso = input.now.toISOString();
    const result = await db.execute<{
        id: string;
        stripe_checkout_session_id: string;
        expires_at: Date;
    }>(sql`
        select id, stripe_checkout_session_id, expires_at
        from ${foundingMemberReservations}
        where ${foundingMemberReservations.status} = 'reserved'
          and ${foundingMemberReservations.stripeCheckoutSessionId} is not null
          and ${foundingMemberReservations.expiresAt} <= ${nowIso}::timestamp
        order by ${foundingMemberReservations.expiresAt} asc
        limit ${input.limit}
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: typeof result }).rows ?? []);
    return rows.map((row) => ({
        id: row.id,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        expiresAt: row.expires_at,
    }));
}

/** Clear active founding pricing without reopening the first-100 claim slot. */
export async function forfeitFoundingMember(userId: string): Promise<void> {
    await db
        .update(users)
        .set({
            foundingMember: false,
            foundingMemberClaimedAt: sql`coalesce(${users.foundingMemberClaimedAt}, ${users.everPaidAt}, now())`,
            updatedAt: new Date(),
        })
        .where(and(eq(users.id, userId), eq(users.foundingMember, true)));
}

/**
 * Set the deletion timestamp. Idempotent: if a deletion is already
 * scheduled we keep the EARLIER timestamp (so a trial-end schedule isn't
 * pushed out by a later cancel event). Pass `force: true` to override.
 *
 * Returns the *effective* persisted timestamp -- the value actually
 * written, or the earlier existing value that was kept -- so callers
 * that surface this date to the user (e.g. the grace-started email)
 * show what's really in the DB instead of re-deriving their own value,
 * which would drift (and defeat dedup, since the grace-started email's
 * dedup key includes this timestamp) on repeated mirror/reconcile runs.
 */
export async function scheduleAccountDeletion(input: {
    userId: string;
    scheduledAt: Date;
    force?: boolean;
}): Promise<Date> {
    if (input.force) {
        const [updated] = await db
            .update(users)
            .set({
                accountDeletionScheduledAt: input.scheduledAt,
                updatedAt: new Date(),
            })
            .where(eq(users.id, input.userId))
            .returning({
                accountDeletionScheduledAt: users.accountDeletionScheduledAt,
            });
        return updated?.accountDeletionScheduledAt ?? input.scheduledAt;
    }
    const [updated] = await db
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
        )
        .returning({
            accountDeletionScheduledAt: users.accountDeletionScheduledAt,
        });
    if (updated) return updated.accountDeletionScheduledAt ?? input.scheduledAt;

    // Kept the earlier existing value; read it back so the caller has the
    // real effective date rather than the later one it just tried to set.
    const [existing] = await db
        .select({
            accountDeletionScheduledAt: users.accountDeletionScheduledAt,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
    return existing?.accountDeletionScheduledAt ?? input.scheduledAt;
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

/** Hard-delete a user while preserving any lifetime founding-capacity claim. */
export async function deleteUser(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('billing_founding_members', 0))`,
        );

        const [user] = await tx
            .select({
                foundingMember: users.foundingMember,
                foundingMemberClaimedAt: users.foundingMemberClaimedAt,
                everPaidAt: users.everPaidAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (
            user &&
            (user.foundingMember || user.foundingMemberClaimedAt !== null)
        ) {
            const [consumedClaim] = await tx
                .select({ id: foundingMemberReservations.id })
                .from(foundingMemberReservations)
                .where(
                    and(
                        eq(foundingMemberReservations.userId, userId),
                        eq(foundingMemberReservations.status, "consumed"),
                    ),
                )
                .limit(1);
            if (!consumedClaim) {
                const claimedAt =
                    user.foundingMemberClaimedAt ??
                    user.everPaidAt ??
                    new Date();
                await tx.insert(foundingMemberReservations).values({
                    userId,
                    stripePriceId: "legacy-founding-claim",
                    status: "consumed",
                    reservedAt: claimedAt,
                    expiresAt: claimedAt,
                    consumedAt: claimedAt,
                    createdAt: claimedAt,
                    updatedAt: claimedAt,
                });
            }
        }

        await tx.delete(users).where(eq(users.id, userId));
    });
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

export type StripeWebhookEventStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed";

export interface ClaimedStripeWebhookEvent {
    eventId: string;
    type: string;
    eventCreatedAt: Date;
    payload: Record<string, unknown>;
    attempts: number;
    claimToken: string;
}

/**
 * Durably records a verified Stripe event. The unique event id makes Stripe
 * redelivery safe without conflating receipt with successful processing.
 */
export async function enqueueStripeWebhookEvent(input: {
    eventId: string;
    type: string;
    eventCreatedAt: Date;
    payload: Record<string, unknown>;
}): Promise<boolean> {
    const inserted = await db
        .insert(stripeWebhookEvents)
        .values({
            eventId: input.eventId,
            type: input.type,
            eventCreatedAt: input.eventCreatedAt,
            payload: input.payload,
            status: "pending",
        })
        .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
        .returning({ eventId: stripeWebhookEvents.eventId });
    return inserted.length > 0;
}

/**
 * Atomically claims due inbox rows. Processing claims expire so a process
 * crash cannot strand an event forever; claim-token-scoped completion writes
 * prevent a stale worker from overwriting the newer claimant's result.
 */
export async function claimDueStripeWebhookEvents(input: {
    limit: number;
    processingLeaseMs: number;
}): Promise<ClaimedStripeWebhookEvent[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.processingLeaseMs);
    const nowIso = now.toISOString();
    const claimed = await db.execute<{
        event_id: string;
        type: string;
        event_created_at: Date;
        payload: Record<string, unknown>;
        attempts: number;
        claim_token: string;
    }>(sql`
        update ${stripeWebhookEvents}
        set
            status = 'processing',
            claim_token = gen_random_uuid()::text,
            started_at = ${nowIso}::timestamp,
            next_attempt_at = ${leaseExpiresAt.toISOString()}::timestamp,
            updated_at = ${nowIso}::timestamp
        where event_id in (
            select event_id
            from ${stripeWebhookEvents}
            where (
                (status = 'pending' and next_attempt_at <= ${nowIso}::timestamp)
                or (status = 'processing' and next_attempt_at <= ${nowIso}::timestamp)
            )
            order by next_attempt_at asc, created_at asc
            limit ${input.limit}
            for update skip locked
        )
        returning event_id, type, event_created_at, payload, attempts, claim_token
    `);
    const rows = Array.isArray(claimed)
        ? claimed
        : ((claimed as { rows: typeof claimed }).rows ?? []);
    return rows.map((row) => ({
        eventId: row.event_id,
        type: row.type,
        eventCreatedAt: row.event_created_at,
        payload: row.payload,
        attempts: row.attempts,
        claimToken: row.claim_token,
    }));
}

/** Serializes event side effects across workers for one Stripe event id. */
export async function withStripeWebhookEventLock<T>(
    eventId: string,
    run: () => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`,
        );
        return run();
    });
}

/** Extends a live claim so long-running handlers are not reclaimed mid-flight. */
export async function renewStripeWebhookEventClaim(input: {
    eventId: string;
    claimToken: string;
    processingLeaseMs: number;
}): Promise<boolean> {
    const now = new Date();
    const rows = await db
        .update(stripeWebhookEvents)
        .set({
            nextAttemptAt: new Date(now.getTime() + input.processingLeaseMs),
            updatedAt: now,
        })
        .where(
            and(
                eq(stripeWebhookEvents.eventId, input.eventId),
                eq(stripeWebhookEvents.status, "processing"),
                eq(stripeWebhookEvents.claimToken, input.claimToken),
            ),
        )
        .returning({ eventId: stripeWebhookEvents.eventId });
    return rows.length > 0;
}

/** Completes an event while its event-scoped advisory lock is held. */
export async function completeStripeWebhookEventUnderLock(
    eventId: string,
): Promise<boolean> {
    const rows = await db
        .update(stripeWebhookEvents)
        .set({
            status: "completed",
            completedAt: new Date(),
            claimToken: null,
            startedAt: null,
            lastError: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(stripeWebhookEvents.eventId, eventId),
                eq(stripeWebhookEvents.status, "processing"),
            ),
        )
        .returning({ eventId: stripeWebhookEvents.eventId });
    return rows.length > 0;
}

export async function completeStripeWebhookEvent(input: {
    eventId: string;
    claimToken: string;
}): Promise<boolean> {
    const rows = await db
        .update(stripeWebhookEvents)
        .set({
            status: "completed",
            completedAt: new Date(),
            claimToken: null,
            startedAt: null,
            lastError: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(stripeWebhookEvents.eventId, input.eventId),
                eq(stripeWebhookEvents.status, "processing"),
                eq(stripeWebhookEvents.claimToken, input.claimToken),
            ),
        )
        .returning({ eventId: stripeWebhookEvents.eventId });
    return rows.length > 0;
}

/** Records a failed attempt and schedules exponential retry or terminal failure. */
export async function failStripeWebhookEvent(input: {
    eventId: string;
    claimToken: string;
    errorMessage: string;
    maxAttempts: number;
    retryAt: Date;
}): Promise<{ status: StripeWebhookEventStatus; attempts: number } | null> {
    const retryAtIso = input.retryAt.toISOString();
    const rows = await db.execute<{
        status: StripeWebhookEventStatus;
        attempts: number;
    }>(sql`
        update ${stripeWebhookEvents}
        set
            attempts = attempts + 1,
            status = case
                when attempts + 1 >= ${input.maxAttempts} then 'failed'
                else 'pending'
            end,
            claim_token = null,
            started_at = null,
            next_attempt_at = case
                when attempts + 1 >= ${input.maxAttempts} then next_attempt_at
                else ${retryAtIso}::timestamp
            end,
            last_error = ${input.errorMessage},
            failed_at = case
                when attempts + 1 >= ${input.maxAttempts} then now()
                else null
            end,
            updated_at = now()
        where event_id = ${input.eventId}
          and status = 'processing'
          and claim_token = ${input.claimToken}
        returning status, attempts
    `);
    const row = Array.isArray(rows)
        ? rows[0]
        : ((
              rows as {
                  rows: {
                      status: StripeWebhookEventStatus;
                      attempts: number;
                  }[];
              }
          ).rows ?? [])[0];
    return row ?? null;
}

export interface UserBillingState {
    plan: "self_host" | "hosted_free" | "hosted_pro" | null;
    planTransitionUntil: Date | null;
    monthlyMynahSecondsRemaining: number;
    monthlyMynahGrantResetAt: Date | null;
    foundingMember: boolean;
    foundingMemberClaimedAt: Date | null;
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
            foundingMemberClaimedAt: users.foundingMemberClaimedAt,
            everPaidAt: users.everPaidAt,
            accountDeletionScheduledAt: users.accountDeletionScheduledAt,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return (rows[0] as UserBillingState | undefined) ?? null;
}

export interface UserActivitySummary {
    recordingCount: number;
    totalDurationMs: number;
}

/**
 * Live (non-tombstoned) recording count + total duration for a user.
 * Used to personalize lifecycle email copy (e.g. the welcome email)
 * with what the user has actually done, not generic congratulations.
 */
export async function getUserActivitySummary(
    userId: string,
): Promise<UserActivitySummary> {
    const rows = await db
        .select({
            recordingCount: sql<number>`count(*)::int`,
            totalDurationMs: sql<number>`coalesce(sum(${recordings.duration}), 0)::bigint`,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, userId),
                sql`${recordings.deletedAt} is null`,
            ),
        );
    return {
        recordingCount: Number(rows[0]?.recordingCount ?? 0),
        totalDurationMs: Number(rows[0]?.totalDurationMs ?? 0),
    };
}

/**
 * 1-indexed rank among all claimed founding members, ordered by claim
 * time (earliest = #1). Returns null if the user never claimed
 * founding pricing. Used to show a concrete "you're founding member
 * #N" instead of only the abstract cohort size.
 *
 * Ranks over the same permanent claimed cohort `getFoundingMemberAvailability`
 * counts, not just live `users` rows: `deleteUser` preserves a `consumed`
 * reservation (with `userId` set to null via the FK's `onDelete: set null`)
 * for any founding member it deletes, so an earlier founder who later
 * deletes their account still occupies -- and must still count toward --
 * a permanent slot. Ranking off `users` alone would skip them and hand a
 * later founder a rank that understates how many people actually claimed
 * before them.
 */
export async function getFoundingMemberOrdinal(
    userId: string,
): Promise<number | null> {
    const result = await db.execute<{ rank: number }>(sql`
        select rank from (
            select
                row_number() over (order by claimed_at asc) as rank,
                user_id
            from (
                select
                    ${foundingMemberReservations.consumedAt} as claimed_at,
                    ${foundingMemberReservations.userId} as user_id
                from ${foundingMemberReservations}
                where ${foundingMemberReservations.status} = 'consumed'
                union all
                select
                    u.founding_member_claimed_at as claimed_at,
                    u.id as user_id
                from ${users} u
                where u.founding_member_claimed_at is not null
                  and not exists (
                      select 1
                      from ${foundingMemberReservations} r
                      where r.user_id = u.id
                        and r.status = 'consumed'
                  )
            ) claims
        ) ranked
        where ranked.user_id = ${userId}
    `);
    const rows = Array.isArray(result)
        ? result
        : ((result as { rows: { rank: number }[] }).rows ?? []);
    const rank = rows[0]?.rank;
    return rank !== undefined ? Number(rank) : null;
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
