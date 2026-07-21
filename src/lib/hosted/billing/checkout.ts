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
import { mirrorCheckoutSession, mirrorStripeSubscription } from "./mirror";
import {
    type BillingCurrency,
    type BillingInterval,
    isFoundingMonthlyPriceId,
    resolvePrice,
    resolveStandardMonthlyPriceForCurrency,
} from "./pricing";
import { getStripe } from "./stripe-client";
import { prepareCustomerTaxIdentity, type VerifiedBusiness } from "./vat-id";

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
            | "price_unavailable"
            | "checkout_in_progress",
    ) {
        super(message);
        this.name = "CheckoutPreconditionError";
    }
}

/**
 * Resuming an existing, still-open Checkout Session rather than blocking
 * the user with an error. Carries the prior session's own URL/id so the
 * caller can just send the user back into the same Checkout flow instead
 * of surfacing "a checkout is already in progress".
 */
export class CheckoutInProgressError extends CheckoutPreconditionError {
    constructor(
        message: string,
        readonly existingCheckoutUrl: string | null,
        readonly existingSessionId: string,
    ) {
        super(message, "checkout_in_progress");
        this.name = "CheckoutInProgressError";
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
    /** Optional verified EU business identity for reverse-charge treatment. */
    business?: VerifiedBusiness;
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
    let price: ReturnType<typeof resolvePrice>;
    let reservation: FoundingMemberReservationRow | null;
    try {
        ({ price, reservation } = await resolveCheckoutPrice({
            userId: input.userId,
            country: input.country,
            interval,
        }));
    } catch (error) {
        if (error instanceof CheckoutInProgressError) {
            // Reuse the still-open prior session instead of erroring: resume
            // the same Checkout the user already started.
            if (!error.existingCheckoutUrl) {
                throw error;
            }
            return {
                checkoutUrl: error.existingCheckoutUrl,
                sessionId: error.existingSessionId,
            };
        }
        throw error;
    }

    const stripe = getStripe();

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
        await prepareCustomerTaxIdentity({
            stripeCustomerId,
            business: input.business,
        });
        const returnUrl = hostedBillingReturnUrl();
        session = await stripe.checkout.sessions.create(
            {
                mode: "subscription",
                customer: stripeCustomerId,
                line_items: [{ price: price.priceId, quantity: 1 }],
                success_url: returnUrl,
                cancel_url: returnUrl,
                client_reference_id: input.userId,
                billing_address_collection: "required",
                automatic_tax: { enabled: true },
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
        return_url: hostedBillingReturnUrl(),
        configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
    });
    return session.url;
}

export async function cancelSubscriptionImmediatelyForDeletion(
    userId: string,
): Promise<void> {
    const localSubscription = await getSubscriptionByUserId(userId);
    if (!localSubscription || isTerminalStatus(localSubscription.status)) {
        return;
    }

    const stripe = getStripe();
    const current = await stripe.subscriptions.retrieve(localSubscription.id);
    if (isTerminalStatus(current.status)) return;

    const canceled = await stripe.subscriptions.cancel(localSubscription.id);
    if (!isTerminalStatus(canceled.status)) {
        throw new Error("Stripe did not confirm subscription cancellation");
    }
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
        const reservation = await reserveFoundingSlot({
            userId: input.userId,
            stripePriceId: foundingPrice.priceId,
        });
        if (reservation) return { price: foundingPrice, reservation };
    }

    return {
        price: resolveAvailablePrice(input.country, "month", "standard"),
        reservation: null,
    };
}

const MAX_FOUNDING_RESERVATION_ATTEMPTS = 2;

/**
 * Reserve a founding monthly slot for this user, resolving (via Stripe,
 * not a timer) any reservation left over from a checkout attempt this
 * same user already started. Returns `null` when no founding price is
 * available for this user right now -- capacity exhausted or already
 * permanently claimed -- which is the correct signal to silently fall
 * back to standard pricing.
 *
 * Never silently releases a reservation without checking what actually
 * happened to the Stripe Checkout Session it's attached to: releasing
 * one that's still open risks a second concurrent checkout, and
 * releasing one the user already paid on would bump a genuine founding
 * payment to standard price once the (possibly delayed) webhook lands.
 */
async function reserveFoundingSlot(input: {
    userId: string;
    stripePriceId: string;
}): Promise<FoundingMemberReservationRow | null> {
    for (
        let attempt = 0;
        attempt < MAX_FOUNDING_RESERVATION_ATTEMPTS;
        attempt += 1
    ) {
        const now = new Date();
        const result = await createFoundingMemberReservation({
            userId: input.userId,
            capacity: env.BILLING_FOUNDING_MEMBER_CAPACITY,
            stripePriceId: input.stripePriceId,
            now,
            expiresAt: new Date(now.getTime() + FOUNDING_CHECKOUT_TTL_MS),
        });

        if (result.kind === "reserved") return result.reservation;
        if (result.kind === "unavailable") return null;

        // result.kind === "already_reserved": this user already holds a
        // `reserved` row. Find out what actually happened to it before
        // touching it.
        const sessionId = result.existing.stripeCheckoutSessionId;
        if (!sessionId) {
            // Not yet attached to a Checkout Session -- a concurrent request
            // for this same user is mid-flight right now (or crashed between
            // insert and attach). Either way, do not race it. There is no
            // prior session URL to hand back here, so this is a genuine error.
            throw new CheckoutPreconditionError(
                "A checkout for this account is already in progress",
                "checkout_in_progress",
            );
        }

        const stripe = getStripe();
        const priorSession = await stripe.checkout.sessions.retrieve(sessionId);

        if (priorSession.status === "complete") {
            // Already paid; the webhook just hasn't landed yet. Mirror it
            // now instead of releasing the reservation backing a real
            // payment or starting a second checkout.
            await mirrorCheckoutSession(priorSession);
            throw new CheckoutPreconditionError(
                "User already has a live subscription",
                "already_subscribed",
            );
        }

        if (priorSession.status !== "expired") {
            // `open`, or any other non-terminal Stripe session status -- the
            // user already has a live Checkout Session. Send them back into
            // that same session instead of blocking with an error.
            throw new CheckoutInProgressError(
                "A checkout for this account is already in progress",
                priorSession.url,
                priorSession.id,
            );
        }

        // Genuinely dead. Release it and retry once for a fresh reservation.
        await releaseFoundingMemberReservation({
            reservationId: result.existing.id,
            releasedAt: now,
        });
    }

    return null;
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

function isTerminalStatus(status: string): boolean {
    return (
        status === "canceled" ||
        status === "unpaid" ||
        status === "incomplete_expired"
    );
}

function hostedBillingReturnUrl(): string {
    if (!env.APP_URL) {
        throw new Error("APP_URL is required for hosted billing");
    }
    return new URL("/settings#billing", env.APP_URL).toString();
}

/** Legacy re-export for older tests/call sites; founding pricing is capacity-based. */
export { isWithinFoundingWindow } from "./plans";
