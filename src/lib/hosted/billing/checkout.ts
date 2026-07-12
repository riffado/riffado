import type Stripe from "stripe";
import {
    attachFoundingMemberReservationToCheckoutSession,
    createFoundingMemberReservation,
    type FoundingMemberReservationRow,
    getBillingCustomerByUserId,
    getSubscriptionByUserId,
    getUserBillingState,
    releaseFoundingMemberReservation,
    upsertBillingCustomer,
} from "@/db/queries/billing";
import { env } from "@/lib/env";
import { mirrorStripeSubscription } from "./mirror";
import {
    type BillingCurrency,
    type BillingInterval,
    isFoundingMonthlyPriceId,
    resolvePrice,
    resolveStandardMonthlyPriceForCurrency,
} from "./pricing";
import { getStripe } from "./stripe-client";

export class CheckoutPreconditionError extends Error {
    constructor(
        message: string,
        readonly code:
            | "already_subscribed"
            | "missing_waiver"
            | "missing_subscription"
            | "subscription_not_canceled"
            | "subscription_expired"
            | "missing_stripe_customer"
            | "missing_portal_configuration"
            | "reactivation_failed"
            | "price_unavailable",
    ) {
        super(message);
        this.name = "CheckoutPreconditionError";
    }
}

/**
 * Idempotent Stripe customer create + local mapping insert.
 *
 * The DB check-then-create above isn't atomic: two concurrent checkout
 * submits for the same user can both pass `getBillingCustomerByUserId`
 * as "no customer yet" before either write lands, each creating its own
 * Stripe customer (with the last local upsert silently winning and
 * orphaning the other Stripe customer). A stable, per-user Stripe
 * idempotency key closes that gap at the Stripe layer: Stripe caches
 * the response for a repeated key + request body, so the second
 * concurrent call gets back the SAME customer.id instead of creating a
 * duplicate. Deliberately not a fresh nonce per call (unlike the
 * Checkout Session idempotency key below) -- it must be identical
 * across concurrent calls for the same user to collide correctly.
 */
export async function getOrCreateStripeCustomer(input: {
    userId: string;
    email: string;
    name?: string | null;
}): Promise<string> {
    const existing = await getBillingCustomerByUserId(input.userId);
    if (existing) return existing.stripeCustomerId;

    const stripe = getStripe();
    const customer = await stripe.customers.create(
        {
            email: input.email,
            name: input.name ?? undefined,
            metadata: { userId: input.userId },
        },
        { idempotencyKey: `stripe-customer:${input.userId}` },
    );

    await upsertBillingCustomer({
        userId: input.userId,
        stripeCustomerId: customer.id,
    });

    return customer.id;
}

export interface StartCheckoutInput {
    userId: string;
    userEmail: string;
    userName?: string | null;
    /** Buyer country (ISO-3166-1 alpha-2) for currency resolution. */
    country?: string | null;
    /** Billing interval selected for Checkout. Defaults to monthly. */
    interval?: BillingInterval;
    /** Where Stripe returns the user after a completed checkout. */
    redirectUrl: string;
    /** Where Stripe returns the user if they abandon checkout. */
    cancelUrl?: string;
    /** Required: EU consumer-law waiver timestamp captured at submit. */
    withdrawalWaiverAcceptedAt: Date;
    /**
     * Fresh nonce per request for the Stripe idempotency key. Guards the
     * Stripe SDK's automatic retries of this single Checkout Session create
     * (a timed-out create won't spawn a duplicate). Not a cross-submit dedup.
     */
    idempotencyKey: string;
}

export interface StartCheckoutResult {
    checkoutUrl: string;
    sessionId: string;
}

const FOUNDING_CHECKOUT_TTL_MS = 35 * 60 * 1000;
const FOUNDING_RESERVATION_METADATA_KEY = "foundingReservationId";
const FOUNDING_RESERVATION_EXPIRES_METADATA_KEY =
    "foundingReservationExpiresAt";

/**
 * Start a Stripe Checkout Session (`mode: subscription`). Stripe creates
 * the customer's subscription, collects payment, and bills the first
 * invoice in one hosted flow; we mirror the resulting subscription from
 * the `checkout.session.completed` webhook.
 *
 * Throws `CheckoutPreconditionError({code:"already_subscribed"})` when a
 * live subscription already exists; the route then attempts reactivation
 * (clearing a pending cancel) or sends the user to the Customer Portal.
 */
export async function startSubscriptionCheckout(
    input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
    if (!input.withdrawalWaiverAcceptedAt) {
        throw new CheckoutPreconditionError(
            "Withdrawal waiver consent is required",
            "missing_waiver",
        );
    }

    const existing = await getSubscriptionByUserId(input.userId);
    if (existing && isLiveStatus(existing.status)) {
        throw new CheckoutPreconditionError(
            "User already has a live subscription",
            "already_subscribed",
        );
    }

    const interval = input.interval ?? "month";
    const { price, reservation } = await resolveCheckoutPrice({
        userId: input.userId,
        country: input.country,
        interval,
    });

    const stripe = getStripe();

    // VAT line on invoices for EU/EEA (EUR) sales only. USD sales are
    // non-EU export of services, outside EU VAT scope -- no rate applied.
    const taxRateId =
        price.currency === "eur" ? env.STRIPE_TAX_RATE_ID_EUR : undefined;

    const metadata = checkoutMetadata({
        userId: input.userId,
        reservation,
    });

    let session: Stripe.Checkout.Session;
    try {
        const stripeCustomerId = await getOrCreateStripeCustomer({
            userId: input.userId,
            email: input.userEmail,
            name: input.userName ?? null,
        });
        session = await stripe.checkout.sessions.create(
            {
                mode: "subscription",
                customer: stripeCustomerId,
                line_items: [{ price: price.priceId, quantity: 1 }],
                success_url: input.redirectUrl,
                cancel_url: input.cancelUrl ?? input.redirectUrl,
                client_reference_id: input.userId,
                billing_address_collection: "required",
                ...(reservation
                    ? {
                          expires_at: Math.floor(
                              reservation.expiresAt.getTime() / 1000,
                          ),
                      }
                    : {}),
                // Persist the collected billing address back onto the existing
                // Customer; Checkout skips this for a passed-in customer unless
                // customer_update is set, which would leave billing_country null.
                customer_update: { address: "auto", name: "auto" },
                subscription_data: {
                    metadata: {
                        ...metadata,
                        withdrawalWaiverAcceptedAt:
                            input.withdrawalWaiverAcceptedAt.toISOString(),
                    },
                    // Applied to every renewal invoice, not just the first.
                    ...(taxRateId ? { default_tax_rates: [taxRateId] } : {}),
                },
                metadata,
            },
            { idempotencyKey: input.idempotencyKey },
        );
    } catch (error) {
        if (reservation) {
            await releaseFoundingMemberReservation({
                reservationId: reservation.id,
                releasedAt: new Date(),
            });
        }
        throw error;
    }

    if (reservation) {
        const attached = await attachFoundingMemberReservationToCheckoutSession(
            {
                reservationId: reservation.id,
                checkoutSessionId: session.id,
            },
        );
        if (!attached) {
            await stripe.checkout.sessions.expire(session.id);
            throw new CheckoutPreconditionError(
                "The founding monthly reservation is no longer available",
                "price_unavailable",
            );
        }
    }

    if (!session.url) {
        throw new Error("Stripe did not return a Checkout Session URL");
    }
    return { checkoutUrl: session.url, sessionId: session.id };
}

/**
 * Clear a pending `cancel_at_period_end` so the subscription continues.
 * No new charge -- the user is still inside a paid period they already
 * bought. Called by the checkout route when `already_subscribed` is
 * thrown and the existing subscription is set to cancel at period end.
 */
export async function reactivateSubscriptionIfStillInPeriod(input: {
    userId: string;
}): Promise<void> {
    const sub = await getSubscriptionByUserId(input.userId);
    if (!sub) {
        throw new CheckoutPreconditionError(
            "No subscription found for user",
            "missing_subscription",
        );
    }
    if (!isLiveStatus(sub.status)) {
        throw new CheckoutPreconditionError(
            "Subscription is not in a reactivatable state",
            "subscription_expired",
        );
    }

    const stripe = getStripe();
    const current = await stripe.subscriptions.retrieve(sub.id);
    if (!current.cancel_at_period_end) {
        throw new CheckoutPreconditionError(
            "Subscription is active and not scheduled to cancel",
            "subscription_not_canceled",
        );
    }

    const state = await getUserBillingState(input.userId);
    const item = current.items.data[0];
    const priceCurrency = item?.price.currency as BillingCurrency | undefined;
    const lostFoundingPrice =
        state?.foundingMember === false &&
        isFoundingMonthlyPriceId(
            typeof item?.price.id === "string" ? item.price.id : null,
        );
    const replacement =
        lostFoundingPrice && priceCurrency
            ? resolveStandardMonthlyPriceForCurrency(priceCurrency)
            : null;

    const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: false,
        ...(replacement && item
            ? {
                  items: [{ id: item.id, price: replacement.priceId }],
                  proration_behavior: "none" as const,
              }
            : {}),
    });
    await mirrorStripeSubscription(updated);
}

/**
 * Cancel at period end. The user keeps Pro access through the paid
 * period (Stripe keeps status `active` with `cancel_at_period_end`),
 * then the subscription transitions to `canceled` and our mirror demotes
 * the plan. Most users will cancel via the Customer Portal; this is the
 * programmatic fallback.
 */
export async function cancelSubscription(userId: string): Promise<void> {
    const sub = await getSubscriptionByUserId(userId);
    if (!sub) {
        throw new CheckoutPreconditionError(
            "No subscription found for user",
            "missing_subscription",
        );
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
    });
    await mirrorStripeSubscription(updated);
}

/**
 * Create a Stripe Billing Portal session so the user can manage their
 * payment method, view invoices, and cancel. Returns the portal URL.
 */
export async function createBillingPortalSession(input: {
    userId: string;
    returnUrl: string;
}): Promise<string> {
    if (!env.STRIPE_PORTAL_CONFIGURATION_ID) {
        throw new CheckoutPreconditionError(
            "Billing portal is not safely configured",
            "missing_portal_configuration",
        );
    }

    const customer = await getBillingCustomerByUserId(input.userId);
    if (!customer) {
        throw new CheckoutPreconditionError(
            "User has no Stripe customer",
            "missing_stripe_customer",
        );
    }
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: input.returnUrl,
        configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
    });
    return session.url;
}

async function resolveCheckoutPrice(input: {
    userId: string;
    country?: string | null;
    interval: BillingInterval;
}): Promise<{
    price: ReturnType<typeof resolvePrice>;
    reservation: FoundingMemberReservationRow | null;
}> {
    if (input.interval !== "month") {
        return {
            price: resolveAvailablePrice(input.country, "year", "standard"),
            reservation: null,
        };
    }

    const foundingPrice = resolveOptionalPrice(
        input.country,
        "month",
        "founding",
    );
    if (foundingPrice) {
        const now = new Date();
        const reservation = await createFoundingMemberReservation({
            userId: input.userId,
            capacity: env.BILLING_FOUNDING_MEMBER_CAPACITY,
            stripePriceId: foundingPrice.priceId,
            now,
            expiresAt: new Date(now.getTime() + FOUNDING_CHECKOUT_TTL_MS),
        });
        if (reservation) return { price: foundingPrice, reservation };
    }

    return {
        price: resolveAvailablePrice(input.country, "month", "standard"),
        reservation: null,
    };
}

function resolveAvailablePrice(
    country: string | null | undefined,
    interval: BillingInterval,
    monthlyKind: "founding" | "standard" = "founding",
): ReturnType<typeof resolvePrice> {
    try {
        return resolvePrice(country, interval, monthlyKind);
    } catch {
        throw new CheckoutPreconditionError(
            `The ${interval === "year" ? "annual" : "monthly"} plan is not available for checkout`,
            "price_unavailable",
        );
    }
}

function resolveOptionalPrice(
    country: string | null | undefined,
    interval: BillingInterval,
    monthlyKind: "founding" | "standard",
): ReturnType<typeof resolvePrice> | null {
    try {
        return resolvePrice(country, interval, monthlyKind);
    } catch {
        return null;
    }
}

function checkoutMetadata(input: {
    userId: string;
    reservation: FoundingMemberReservationRow | null;
}): Record<string, string> {
    if (!input.reservation) return { userId: input.userId };
    return {
        userId: input.userId,
        [FOUNDING_RESERVATION_METADATA_KEY]: input.reservation.id,
        [FOUNDING_RESERVATION_EXPIRES_METADATA_KEY]:
            input.reservation.expiresAt.toISOString(),
    };
}

function isLiveStatus(status: string): boolean {
    return (
        status === "active" || status === "trialing" || status === "past_due"
    );
}

/** Legacy re-export for older tests/call sites; founding pricing is capacity-based. */
export { isWithinFoundingWindow } from "./plans";
