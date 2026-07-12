import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/lib/env";
import { configuredProPriceIds } from "@/lib/hosted/billing/pricing";

export interface BillingOverviewRow {
    totalUsers: number;
    proPlan: number;
    freePlan: number;
    inTrial: number;
    inGrace: number;
    foundingMembers: number;
    foundingSlotsClaimed: number;
    foundingSlotsReserved: number;
    foundingSlotsRemaining: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    cancelPendingSubscriptions: number;
    monthlySubscriptions: number;
    annualSubscriptions: number;
    firstPaymentsLast30Days: number;
}

export interface BillingMrrCurrencyRow {
    amountCurrency: string;
    monthlyEquivalent: string;
    subscriptionCount: number;
}

export interface UnknownLivePriceGroupRow {
    stripePriceId: string | null;
    status: string;
    amountCurrency: string;
    interval: string;
    subscriptionCount: number;
}

export interface BillingOverview {
    counts: BillingOverviewRow;
    activeMrrByCurrency: BillingMrrCurrencyRow[];
    unknownLivePriceGroups: UnknownLivePriceGroupRow[];
}

const LIVE_STATUS_SQL = sql`('active','trialing','past_due')`;

export async function billingOverview(): Promise<BillingOverview> {
    const knownPriceIds = configuredProPriceIds();
    const recognizedPriceFilter = priceIdInFilter(knownPriceIds);
    const unknownPriceFilter = priceIdNotInFilter(knownPriceIds);

    const [counts] = await db.execute<
        BillingOverviewRow & Record<string, unknown>
    >(sql`
        select
            (select count(*)::int from users) as "totalUsers",
            (select count(*)::int from users where plan = 'hosted_pro') as "proPlan",
            (select count(*)::int from users where plan = 'hosted_free') as "freePlan",
            (select count(*)::int from users
             where plan = 'hosted_pro'
               and plan_transition_until is not null
               and plan_transition_until > now()
               and not exists (
                   select 1 from subscriptions s
                   where s.user_id = users.id
                     and s.status in ${LIVE_STATUS_SQL}
               )
            ) as "inTrial",
            (select count(*)::int from users where account_deletion_scheduled_at is not null) as "inGrace",
            (select count(*)::int from users where founding_member = true) as "foundingMembers",
            (select count(*)::int from users where founding_member_claimed_at is not null) as "foundingSlotsClaimed",
            (select count(*)::int from founding_member_reservations where status = 'reserved') as "foundingSlotsReserved",
            greatest(
                0,
                ${env.BILLING_FOUNDING_MEMBER_CAPACITY}::int
                - (select count(*)::int from users where founding_member_claimed_at is not null)
                - (select count(*)::int from founding_member_reservations where status = 'reserved')
            ) as "foundingSlotsRemaining",
            (select count(*)::int from subscriptions where status = 'active') as "activeSubscriptions",
            (select count(*)::int from subscriptions where status = 'past_due') as "pastDueSubscriptions",
            (select count(*)::int from subscriptions where status in ${LIVE_STATUS_SQL} and canceled_at is not null) as "cancelPendingSubscriptions",
            (select count(*)::int from subscriptions where status in ${LIVE_STATUS_SQL} and lower(interval) like '%month%') as "monthlySubscriptions",
            (select count(*)::int from subscriptions where status in ${LIVE_STATUS_SQL} and lower(interval) like '%year%') as "annualSubscriptions",
            (select count(*)::int from users where ever_paid_at >= now() - interval '30 days') as "firstPaymentsLast30Days"
    `);

    const activeMrrByCurrency = await db.execute<
        BillingMrrCurrencyRow & Record<string, unknown>
    >(sql`
        select
            upper(s.amount_currency) as "amountCurrency",
            coalesce(
                sum(
                    case
                        when lower(s.interval) like '%year%' then (s.amount_value::numeric / 12)
                        else s.amount_value::numeric
                    end
                ),
                0
            )::text as "monthlyEquivalent",
            count(*)::int as "subscriptionCount"
        from subscriptions s
        where s.status = 'active'
          ${recognizedPriceFilter}
        group by upper(s.amount_currency)
        order by upper(s.amount_currency) asc
    `);

    const unknownLivePriceGroups = await db.execute<
        UnknownLivePriceGroupRow & Record<string, unknown>
    >(sql`
        select
            s.stripe_price_id as "stripePriceId",
            s.status,
            upper(s.amount_currency) as "amountCurrency",
            s.interval,
            count(*)::int as "subscriptionCount"
        from subscriptions s
        where s.status in ${LIVE_STATUS_SQL}
          ${unknownPriceFilter}
        group by s.stripe_price_id, s.status, upper(s.amount_currency), s.interval
        order by count(*) desc, s.status asc, upper(s.amount_currency) asc, s.interval asc
    `);

    return {
        counts,
        activeMrrByCurrency: [...activeMrrByCurrency],
        unknownLivePriceGroups: [...unknownLivePriceGroups],
    };
}

export interface SubscriptionRow {
    subId: string;
    userId: string;
    userEmail: string;
    stripePriceId: string | null;
    status: string;
    amountValue: string;
    amountCurrency: string;
    interval: string;
    nextPaymentAt: Date | null;
    canceledAt: Date | null;
    createdAt: Date;
}

export async function listSubscriptions(opts: {
    limit: number;
    offset: number;
    status?: string;
}): Promise<{ rows: SubscriptionRow[]; total: number }> {
    const statusFilter = opts.status
        ? sql`and s.status = ${opts.status}`
        : sql``;

    const [countRow] = await db.execute<
        { count: number } & Record<string, unknown>
    >(sql`
        select count(*)::int as count
        from subscriptions s
        where 1=1 ${statusFilter}
    `);

    const rows = await db.execute<
        SubscriptionRow & Record<string, unknown>
    >(sql`
        select
            s.id as "subId",
            s.user_id as "userId",
            u.email as "userEmail",
            s.stripe_price_id as "stripePriceId",
            s.status,
            s.amount_value as "amountValue",
            s.amount_currency as "amountCurrency",
            s.interval,
            s.next_payment_at as "nextPaymentAt",
            s.canceled_at as "canceledAt",
            s.created_at as "createdAt"
        from subscriptions s
        join users u on u.id = s.user_id
        where 1=1 ${statusFilter}
        order by s.created_at desc
        limit ${opts.limit}
        offset ${opts.offset}
    `);

    return { rows: [...rows], total: countRow.count };
}

export interface GraceUserRow {
    userId: string;
    email: string;
    plan: string;
    everPaidAt: Date | null;
    deletionAt: Date;
    createdAt: Date;
}

export async function listGraceUsers(): Promise<GraceUserRow[]> {
    const rows = await db.execute<GraceUserRow & Record<string, unknown>>(sql`
        select
            id as "userId",
            email,
            plan,
            ever_paid_at as "everPaidAt",
            account_deletion_scheduled_at as "deletionAt",
            created_at as "createdAt"
        from users
        where account_deletion_scheduled_at is not null
        order by account_deletion_scheduled_at asc
    `);
    return [...rows];
}

function priceIdInFilter(priceIds: string[]) {
    if (priceIds.length === 0) return sql`and false`;
    return sql`and s.stripe_price_id in (${sql.join(
        priceIds.map((priceId) => sql`${priceId}`),
        sql`, `,
    )})`;
}

function priceIdNotInFilter(priceIds: string[]) {
    if (priceIds.length === 0) return sql``;
    return sql`and (s.stripe_price_id is null or s.stripe_price_id not in (${sql.join(
        priceIds.map((priceId) => sql`${priceId}`),
        sql`, `,
    )}))`;
}
