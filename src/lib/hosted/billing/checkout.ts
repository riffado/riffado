import {
    getBillingCustomerByUserId,
    getSubscriptionByUserId,
    upsertBillingCustomer,
} from "@/db/queries/billing";
import { env } from "@/lib/env";
import { mirrorStripeSubscription } from "./mirror";
import { resolvePrice } from "./pricing";
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
            | "reactivation_failed",
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

    const stripeCustomerId = await getOrCreateStripeCustomer({
        userId: input.userId,
        email: input.userEmail,
        name: input.userName ?? null,
    });

    const price = resolvePrice(input.country);
    const stripe = getStripe();

    // VAT line on invoices for EU/EEA (EUR) sales only. USD sales are
    // non-EU export of services, outside EU VAT scope -- no rate applied.
    const taxRateId =
        price.currency === "eur" ? env.STRIPE_TAX_RATE_ID_EUR : undefined;

    const session = await stripe.checkout.sessions.create(
        {
            mode: "subscription",
            customer: stripeCustomerId,
            line_items: [{ price: price.priceId, quantity: 1 }],
            success_url: input.redirectUrl,
            cancel_url: input.cancelUrl ?? input.redirectUrl,
            client_reference_id: input.userId,
            billing_address_collection: "required",
            // Persist the collected billing address back onto the existing
            // Customer; Checkout skips this for a passed-in customer unless
            // customer_update is set, which would leave billing_country null.
            customer_update: { address: "auto", name: "auto" },
            subscription_data: {
                metadata: {
                    userId: input.userId,
                    withdrawalWaiverAcceptedAt:
                        input.withdrawalWaiverAcceptedAt.toISOString(),
                },
                // Applied to every renewal invoice, not just the first.
                ...(taxRateId ? { default_tax_rates: [taxRateId] } : {}),
            },
            metadata: { userId: input.userId },
        },
        { idempotencyKey: input.idempotencyKey },
    );

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

    const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: false,
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
        ...(env.STRIPE_PORTAL_CONFIGURATION_ID
            ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID }
            : {}),
    });
    return session.url;
}

function isLiveStatus(status: string): boolean {
    return (
        status === "active" || status === "trialing" || status === "past_due"
    );
}

/** Re-exported so the env-driven founding window lives in one place. */
export { isWithinFoundingWindow } from "./plans";
