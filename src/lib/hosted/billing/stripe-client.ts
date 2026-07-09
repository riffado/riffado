import Stripe from "stripe";
import { env } from "@/lib/env";

export class StripeNotConfiguredError extends Error {
    constructor() {
        super(
            "Stripe is not configured. Set STRIPE_SECRET_KEY to enable hosted billing.",
        );
        this.name = "StripeNotConfiguredError";
    }
}

let stripeClient: Stripe | null = null;

/** Lazily-constructed Stripe client. Throws if `STRIPE_SECRET_KEY` is unset. */
export function getStripe(): Stripe {
    if (!env.STRIPE_SECRET_KEY) throw new StripeNotConfiguredError();
    if (!stripeClient) {
        stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
            // Pin explicitly to the version the bundled types target, so the
            // runtime response shape matches the TS surface regardless of the
            // account's dashboard default or a future SDK minor bump.
            apiVersion: "2026-06-24.dahlia",
            typescript: true,
            appInfo: { name: "Riffado", url: "https://riffado.com" },
        });
    }
    return stripeClient;
}

export function isStripeConfigured(): boolean {
    return Boolean(env.STRIPE_SECRET_KEY);
}

export function isStripeTestMode(): boolean {
    return env.STRIPE_SECRET_KEY?.includes("_test_") ?? false;
}
