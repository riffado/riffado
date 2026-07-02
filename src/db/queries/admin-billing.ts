import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface BillingOverviewRow {
    totalUsers: number;
    proPlan: number;
    freePlan: number;
    inTrial: number;
    inGrace: number;
    foundingMembers: number;
    activeSubscriptions: number;
    canceledSubscriptions: number;
}

export async function billingOverview(): Promise<BillingOverviewRow> {
    const [row] = await db.execute<
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
                     and s.status in ('active','trialing','past_due')
               )
            ) as "inTrial",
            (select count(*)::int from users where account_deletion_scheduled_at is not null) as "inGrace",
            (select count(*)::int from users where founding_member = true) as "foundingMembers",
            (select count(*)::int from subscriptions where status = 'active') as "activeSubscriptions",
            (select count(*)::int from subscriptions where status = 'canceled') as "canceledSubscriptions"
    `);
    return row;
}

export interface SubscriptionRow {
    subId: string;
    userId: string;
    userEmail: string;
    status: string;
    amountValue: string;
    amountCurrency: string;
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
            s.status,
            s.amount_value as "amountValue",
            s.amount_currency as "amountCurrency",
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
