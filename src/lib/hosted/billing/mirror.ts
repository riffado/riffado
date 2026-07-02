import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
    clearAccountDeletion,
    getBillingCustomerByStripeId,
    markEverPaid,
    scheduleAccountDeletion,
    setUserPlan,
    stampFoundingMember,
    upsertSubscription,
} from "@/db/queries/billing";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import {
    sendGraceStartedEmail,
    sendWelcomeHostedProEmail,
} from "@/lib/notifications/email";
import { closeCycleForUser } from "./cycle-close";
import {
    classifyGracePath,
    computeDeletionScheduledAt,
    graceDaysForPath,
} from "./grace";
import {
    entitlementsForSubscription,
    isWithinFoundingWindow,
    unixToDate,
} from "./plans";
import { getStripe } from "./stripe-client";

interface NormalizedSubscription {
    id: string;
    userId: string | null;
    stripeCustomerId: string;
    stripePriceId: string | null;
    status: string;
    amountValue: string;
    amountCurrency: string;
    interval: string;
    description: string | null;
    nextPaymentAt: Date | null;
    startDate: Date | null;
    canceledAt: Date | null;
    withdrawalWaiverAcceptedAt: Date | null;
}

function customerIdOf(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string {
    return typeof customer === "string" ? customer : customer.id;
}

function normalize(sub: Stripe.Subscription): NormalizedSubscription {
    const item = sub.items.data[0];
    const price = item?.price ?? null;
    const unitAmount = price?.unit_amount ?? 0;
    const currency = (price?.currency ?? "usd").toUpperCase();
    const recurring = price?.recurring ?? null;
    const interval = recurring
        ? `${recurring.interval_count} ${recurring.interval}`
        : "";

    // cancel_at_period_end keeps status `active` until the period ends; we
    // record the scheduled-cancel timestamp so the UI/grace can show it.
    const canceledAt = sub.cancel_at_period_end
        ? unixToDate(sub.cancel_at ?? item?.current_period_end ?? null)
        : unixToDate(sub.canceled_at);

    const waiverIso = sub.metadata?.withdrawalWaiverAcceptedAt;
    return {
        id: sub.id,
        userId:
            typeof sub.metadata?.userId === "string"
                ? sub.metadata.userId
                : null,
        stripeCustomerId: customerIdOf(sub.customer),
        stripePriceId: price?.id ?? null,
        status: sub.status,
        amountValue: (unitAmount / 100).toFixed(2),
        amountCurrency: currency,
        interval,
        description: price?.nickname ?? env.BILLING_PRO_DESCRIPTION ?? null,
        nextPaymentAt: unixToDate(item?.current_period_end ?? null),
        startDate: unixToDate(sub.start_date),
        canceledAt,
        withdrawalWaiverAcceptedAt:
            typeof waiverIso === "string" ? new Date(waiverIso) : null,
    };
}

/**
 * Mirror a Stripe subscription object into local state: upsert the
 * subscription row, resolve and write the plan, and run the side effects
 * (Pro activation: mark-ever-paid, clear deletion, founding stamp, cycle
 * close, welcome email; lapse: schedule grace deletion + email).
 *
 * Idempotent. The welcome/grace emails dedup once-only at `email_log`,
 * so re-mirroring (webhook redelivery, reconcile) doesn't re-send.
 */
export async function mirrorStripeSubscription(
    sub: Stripe.Subscription,
): Promise<void> {
    const n = normalize(sub);

    const userId =
        n.userId ??
        (await getBillingCustomerByStripeId(n.stripeCustomerId))?.userId ??
        null;
    if (!userId) {
        console.warn(
            `[billing-mirror] subscription ${n.id} has no resolvable user (customer ${n.stripeCustomerId}); skipping`,
        );
        return;
    }

    const billingCountry = await resolveBillingCountry(n.stripeCustomerId);

    await upsertSubscription({
        id: n.id,
        userId,
        stripeCustomerId: n.stripeCustomerId,
        stripePriceId: n.stripePriceId,
        status: n.status,
        amountValue: n.amountValue,
        amountCurrency: n.amountCurrency,
        interval: n.interval,
        description: n.description,
        billingCountry,
        startDate: n.startDate,
        nextPaymentAt: n.nextPaymentAt,
        canceledAt: n.canceledAt,
        withdrawalWaiverAcceptedAt: n.withdrawalWaiverAcceptedAt,
        metadata: sub,
    });

    const planEntry = entitlementsForSubscription({
        status: n.status,
        priceId: n.stripePriceId,
    });
    await setUserPlan({ userId, plan: planEntry.plan });

    if (planEntry.plan === "hosted_pro") {
        await markEverPaid({ userId, paidAt: new Date() });
        await clearAccountDeletion(userId);
        if (isWithinFoundingWindow()) {
            await stampFoundingMember(userId);
        }
        await closeCycleForUser(userId);
        await sendActivationWelcome(userId, {
            amountValue: n.amountValue,
            amountCurrency: n.amountCurrency,
        });
    } else {
        await scheduleDeletionForLapsedUser(userId);
    }
}

/** Webhook/reconcile entry: fetch the subscription by id, then mirror. */
export async function mirrorSubscriptionById(
    subscriptionId: string,
): Promise<void> {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    await mirrorStripeSubscription(sub);
}

/** `checkout.session.completed` entry: resolve the subscription, then mirror. */
export async function mirrorCheckoutSession(
    session: Stripe.Checkout.Session,
): Promise<void> {
    const subId =
        typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
    if (!subId) {
        console.warn(
            `[billing-mirror] checkout session ${session.id} has no subscription; skipping`,
        );
        return;
    }
    await mirrorSubscriptionById(subId);
}

async function resolveBillingCountry(
    stripeCustomerId: string,
): Promise<string | null> {
    try {
        const customer = await getStripe().customers.retrieve(stripeCustomerId);
        if (customer.deleted) return null;
        return customer.address?.country ?? null;
    } catch {
        return null;
    }
}

async function scheduleDeletionForLapsedUser(userId: string): Promise<void> {
    const [row] = await db
        .select({
            email: users.email,
            createdAt: users.createdAt,
            everPaidAt: users.everPaidAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!row) return;
    const path = classifyGracePath({
        createdAt: row.createdAt,
        everPaidAt: row.everPaidAt,
    });
    const scheduledAt = computeDeletionScheduledAt({
        lapseAt: new Date(),
        path,
    });
    await scheduleAccountDeletion({ userId, scheduledAt });

    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base || !row.email) return;
    try {
        await sendGraceStartedEmail({
            userId,
            email: row.email,
            gracePath: path,
            graceDays: graceDaysForPath(path),
            deletionAt: scheduledAt,
            exportUrl: `${base}/settings#export`,
            reactivateUrl: `${base}/settings#billing`,
        });
    } catch (error) {
        console.error(
            `[billing-mirror] grace-started email failed for user ${userId}:`,
            error,
        );
    }
}

async function sendActivationWelcome(
    userId: string,
    plan: { amountValue: string; amountCurrency: string },
): Promise<void> {
    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return;
    const [row] = await db
        .select({
            email: users.email,
            foundingMember: users.foundingMember,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!row?.email) return;
    try {
        await sendWelcomeHostedProEmail({
            userId,
            email: row.email,
            dashboardUrl: `${base}/dashboard`,
            settingsUrl: `${base}/settings#billing`,
            foundingMember: row.foundingMember,
            amountValue: plan.amountValue,
            amountCurrency: plan.amountCurrency,
        });
    } catch (error) {
        console.error(
            `[billing-mirror] welcome email failed for user ${userId}:`,
            error,
        );
    }
}
