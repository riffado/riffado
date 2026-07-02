import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    CheckoutPreconditionError,
    reactivateSubscriptionIfStillInPeriod,
    startSubscriptionCheckout,
} from "@/lib/hosted/billing/checkout";
import { isStripeConfigured } from "@/lib/hosted/billing/stripe-client";

const bodySchema = z.object({
    /** EU consumer-law waiver consent captured at submit. Must be `true`. */
    withdrawalWaiver: z.literal(true),
    /** Stripe returns the user here after the hosted Checkout page. */
    redirectUrl: z.string().url(),
    /** Optional return target if the user abandons checkout. */
    cancelUrl: z.string().url().optional(),
});

/**
 * Start a hosted Pro Stripe Checkout. Returns `{ checkoutUrl }` for a new
 * subscription, OR `{ reactivated: true }` when the user has a
 * subscription scheduled to cancel that we simply resume (no new charge).
 *
 * Currency is resolved from the buyer's country (geo header) -> EU=EUR,
 * else the default currency. Gated on `BILLING_ENABLED` + `IS_HOSTED` +
 * Stripe config; 404/503 otherwise.
 */
export const POST = apiHandler(async (request) => {
    if (!env.IS_HOSTED || !env.BILLING_ENABLED) {
        throw new AppError(ErrorCode.NOT_FOUND, "Billing is not enabled", 404);
    }
    if (!isStripeConfigured()) {
        throw new AppError(
            ErrorCode.NOT_FOUND,
            "Billing is not configured on this instance",
            503,
        );
    }

    const session = await requireApiSession(request);
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Invalid request body",
            400,
            { issues: parsed.error.flatten() },
        );
    }

    const country =
        (env.GEO_COUNTRY_HEADER
            ? request.headers.get(env.GEO_COUNTRY_HEADER)
            : null) ??
        request.headers.get("x-vercel-ip-country") ??
        request.headers.get("cf-ipcountry") ??
        null;
    const waiverAt = new Date();

    try {
        const result = await startSubscriptionCheckout({
            userId: session.user.id,
            userEmail: session.user.email,
            userName: session.user.name ?? null,
            country,
            redirectUrl: parsed.data.redirectUrl,
            cancelUrl: parsed.data.cancelUrl,
            withdrawalWaiverAcceptedAt: waiverAt,
            idempotencyKey: `checkout:${session.user.id}:${randomUUID()}`,
        });
        return NextResponse.json({ checkoutUrl: result.checkoutUrl });
    } catch (error) {
        if (
            error instanceof CheckoutPreconditionError &&
            error.code === "already_subscribed"
        ) {
            try {
                await reactivateSubscriptionIfStillInPeriod({
                    userId: session.user.id,
                });
                return NextResponse.json({ reactivated: true });
            } catch (reactivateError) {
                if (reactivateError instanceof CheckoutPreconditionError) {
                    throw new AppError(
                        ErrorCode.CONFLICT,
                        reactivateError.message,
                        409,
                        { code: reactivateError.code },
                    );
                }
                throw reactivateError;
            }
        }
        if (error instanceof CheckoutPreconditionError) {
            throw new AppError(ErrorCode.CONFLICT, error.message, 409, {
                code: error.code,
            });
        }
        throw error;
    }
});
