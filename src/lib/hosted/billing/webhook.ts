import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
    expireFoundingMemberReservationByCheckoutSession,
    getBillingCustomerByStripeId,
} from "@/db/queries/billing";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { sendPaymentFailedEmail } from "@/lib/notifications/email";
import { captureServerEvent } from "@/lib/posthog-server";
import { mirrorCheckoutSession, mirrorSubscriptionById } from "./mirror";
import { unixToDate } from "./plans";
import { getStripe } from "./stripe-client";

/** Pull the subscription id off an invoice (dahlia `parent` shape + legacy). */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
    const sd = invoice.parent?.subscription_details?.subscription;
    if (sd) return typeof sd === "string" ? sd : sd.id;
    const legacy = (
        invoice as unknown as { subscription?: string | { id: string } | null }
    ).subscription;
    if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
    return null;
}

/**
 * Dispatches one event claimed from the durable Stripe inbox. The receiver
 * verifies and persists events; the worker owns retries and idempotency.
 */
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
    console.log(`[stripe-webhook] processing ${event.type} id=${event.id}`);

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            await mirrorCheckoutSession(session);
            if (session.client_reference_id) {
                await captureServerEvent({
                    distinctId: session.client_reference_id,
                    event: "subscription_activated",
                });
            }
            return;
        }
        case "checkout.session.expired": {
            const session = event.data.object as Stripe.Checkout.Session;
            await expireFoundingMemberReservationByCheckoutSession(
                session.id,
                new Date(event.created * 1000),
            );
            if (session.client_reference_id) {
                await captureServerEvent({
                    distinctId: session.client_reference_id,
                    event: "checkout_abandoned",
                });
            }
            return;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
        case "customer.subscription.paused":
        case "customer.subscription.resumed": {
            await mirrorSubscriptionById(
                (event.data.object as Stripe.Subscription).id,
            );
            return;
        }
        case "invoice.paid": {
            const invoice = event.data.object as Stripe.Invoice;
            const subId = subscriptionIdFromInvoice(invoice);
            if (subId) {
                await mirrorSubscriptionById(subId, {
                    paymentConfirmed: invoice.amount_paid > 0,
                });
            }
            return;
        }
        case "invoice.payment_failed": {
            await handleInvoicePaymentFailed(
                event.data.object as Stripe.Invoice,
            );
            return;
        }
        default:
            console.log(`[stripe-webhook] ignoring ${event.type}`);
            return;
    }
}

async function handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
): Promise<void> {
    const subId = subscriptionIdFromInvoice(invoice);
    if (!subId) return;

    // Re-mirror so the subscription status (-> past_due) is reflected.
    await mirrorSubscriptionById(subId);

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    const metadataUserId =
        typeof sub.metadata?.userId === "string" ? sub.metadata.userId : null;
    // Same fallback mirrorStripeSubscription uses: not every subscription
    // carries `metadata.userId` (e.g. one created before that metadata was
    // added, or manually in the Stripe dashboard), but the customer is
    // still resolvable locally via billing_customers. Without this,
    // payment-failed dunning emails silently never send for those users.
    const userId =
        metadataUserId ??
        (
            await getBillingCustomerByStripeId(
                typeof sub.customer === "string"
                    ? sub.customer
                    : sub.customer.id,
            )
        )?.userId ??
        null;
    if (!userId) return;

    const [row] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!row?.email) return;

    await captureServerEvent({ distinctId: userId, event: "payment_failed" });

    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return;

    await sendPaymentFailedEmail({
        userId,
        email: row.email,
        paymentId: invoice.id ?? `invoice:${subId}`,
        billingUrl: `${base}/settings#billing`,
        nextRetryAt: unixToDate(invoice.next_payment_attempt),
        accessUntil: unixToDate(sub.items.data[0]?.current_period_end ?? null),
    });
}
