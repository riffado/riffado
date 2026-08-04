import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { enqueueStripeWebhookEvent } from "@/db/queries/billing";
import { env } from "@/lib/env";
import {
    getStripe,
    isStripeConfigured,
} from "@/lib/hosted/billing/stripe-client";

/**
 * Stripe webhook receiver. Verifies the signature against
 * `STRIPE_WEBHOOK_SECRET`, then durably queues the verified event. It only
 * acknowledges after persistence; the billing worker processes the inbox.
 * 404 on self-host, 503 if unconfigured.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
    if (!env.IS_HOSTED) {
        return NextResponse.json(
            { error: "Stripe webhooks are only handled on hosted Riffado" },
            { status: 404 },
        );
    }
    if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
        return NextResponse.json(
            { error: "Stripe is not configured on this instance" },
            { status: 503 },
        );
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
        return NextResponse.json(
            { error: "missing stripe-signature header" },
            { status: 400 },
        );
    }

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
        event = await getStripe().webhooks.constructEventAsync(
            rawBody,
            signature,
            env.STRIPE_WEBHOOK_SECRET,
        );
    } catch (error) {
        console.warn(
            "[stripe-webhook] signature verification failed:",
            error instanceof Error ? error.message : error,
        );
        return NextResponse.json(
            { error: "invalid signature" },
            { status: 400 },
        );
    }

    const queued = await enqueueStripeWebhookEvent({
        eventId: event.id,
        type: event.type,
        eventCreatedAt: new Date(event.created * 1000),
        payload: event.data.object as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ received: true, queued });
}
