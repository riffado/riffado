import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
    clearAccountDeletion,
    consumeFoundingMemberReservation,
    forfeitFoundingMember,
    getBillingCustomerByStripeId,
    markEverPaid,
    releaseFoundingMemberReservation,
    scheduleAccountDeletion,
    setUserPlan,
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
import { entitlementsForSubscription, unixToDate } from "./plans";
import {
    type BillingCurrency,
    isFoundingMonthlyPriceId,
    isProPriceId,
    resolveStandardMonthlyPriceForCurrency,
} from "./pricing";
import { getStripe } from "./stripe-client";

interface MirrorOptions {
    paymentConfirmed?: boolean;
}

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
    foundingReservationId: string | null;
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
    const foundingReservationId = sub.metadata?.foundingReservationId;
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
        foundingReservationId:
            typeof foundingReservationId === "string"
                ? foundingReservationId
                : null,
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
    options?: MirrorOptions,
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

    if (isLiveSubscriptionStatus(n.status) && !isProPriceId(n.stripePriceId)) {
        console.warn(
            `[billing-mirror] subscription ${n.id} has live status "${n.status}" but unrecognized price ${n.stripePriceId}; mirrored subscription without mutating plan`,
        );
        return;
    }

    await setUserPlan({ userId, plan: planEntry.plan });

    const hasPaidInvoice = options?.paymentConfirmed === true;

    if (planEntry.plan === "hosted_pro") {
        await clearAccountDeletion(userId);
        await closeCycleForUser(userId);
        if (hasPaidInvoice) {
            if (
                n.interval === "1 month" &&
                isFoundingMonthlyPriceId(n.stripePriceId)
            ) {
                const consumed = await consumeFoundingMemberReservation({
                    reservationId: n.foundingReservationId,
                    userId,
                    stripePriceId: n.stripePriceId ?? "",
                    paidAt: n.startDate ?? new Date(),
                });
                if (!consumed) {
                    const updated =
                        await moveSubscriptionToStandardMonthly(sub);
                    if (n.foundingReservationId) {
                        await releaseFoundingMemberReservation({
                            reservationId: n.foundingReservationId,
                            releasedAt: new Date(),
                        });
                    }
                    await mirrorStripeSubscription(updated, options);
                    return;
                }
            }
            await markEverPaid({
                userId,
                paidAt: new Date(),
            });
            await sendActivationWelcome(userId, {
                amountValue: n.amountValue,
                amountCurrency: n.amountCurrency,
                interval: n.interval === "1 year" ? "year" : "month",
            });
        }
    } else {
        if (n.foundingReservationId && isTerminalSubscriptionStatus(n.status)) {
            await releaseFoundingMemberReservation({
                reservationId: n.foundingReservationId,
                releasedAt: new Date(),
            });
        }
        await forfeitFoundingMember(userId);
        await scheduleDeletionForLapsedUser(userId);
    }
}

function isLiveSubscriptionStatus(status: string): boolean {
    return (
        status === "active" || status === "trialing" || status === "past_due"
    );
}

function isTerminalSubscriptionStatus(status: string): boolean {
    return (
        status === "canceled" ||
        status === "unpaid" ||
        status === "incomplete_expired"
    );
}

/** Webhook/reconcile entry: fetch the subscription by id, then mirror. */
export async function mirrorSubscriptionById(
    subscriptionId: string,
    options?: MirrorOptions,
): Promise<void> {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const paymentConfirmed =
        options?.paymentConfirmed ??
        (await latestInvoiceHasConfirmedPayment(stripe, sub));
    await mirrorStripeSubscription(sub, { paymentConfirmed });
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
    await mirrorSubscriptionById(subId, {
        paymentConfirmed: session.payment_status === "paid",
    });
}

async function latestInvoiceHasConfirmedPayment(
    stripe: Stripe,
    sub: Stripe.Subscription,
): Promise<boolean> {
    const latestInvoice = sub.latest_invoice;
    if (!latestInvoice) return false;
    const invoice =
        typeof latestInvoice === "string"
            ? await stripe.invoices.retrieve(latestInvoice)
            : latestInvoice;
    return invoice.amount_paid > 0;
}

async function moveSubscriptionToStandardMonthly(
    sub: Stripe.Subscription,
): Promise<Stripe.Subscription> {
    const item = sub.items.data[0];
    const currency = item?.price.currency as BillingCurrency | undefined;
    if (!item || !currency) {
        throw new Error(
            `Cannot move subscription ${sub.id} to standard monthly pricing without an item currency`,
        );
    }
    const standard = resolveStandardMonthlyPriceForCurrency(currency);
    if (item.price.id === standard.priceId) return sub;
    return getStripe().subscriptions.update(sub.id, {
        items: [{ id: item.id, price: standard.priceId }],
        proration_behavior: "none",
    });
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
    const scheduledAt = await scheduleAccountDeletion({
        userId,
        scheduledAt: computeDeletionScheduledAt({ lapseAt: new Date(), path }),
    });

    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base || !row.email) return;
    try {
        await sendGraceStartedEmail({
            userId,
            email: row.email,
            gracePath: path,
            graceDays: graceDaysForPath(path),
            trialDays: env.BILLING_TRIAL_DAYS,
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
    plan: {
        amountValue: string;
        amountCurrency: string;
        interval: "month" | "year";
    },
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
            interval: plan.interval,
        });
    } catch (error) {
        console.error(
            `[billing-mirror] welcome email failed for user ${userId}:`,
            error,
        );
    }
}
