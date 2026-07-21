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
import { resolveRequestCountry } from "@/lib/hosted/billing/pricing";
import { isStripeConfigured } from "@/lib/hosted/billing/stripe-client";
import { VatIdVerificationError } from "@/lib/hosted/billing/vat-id";

const bodySchema = z
    .object({
        /** EU consumer-law waiver consent captured at submit. Must be `true`. */
        withdrawalWaiver: z.literal(true),
        /** Billing interval for the Checkout Session. */
        interval: z.enum(["month", "year"]).optional().default("month"),
        /** Optional verified business identity for EU B2B invoicing. */
        business: z
            .object({
                name: z.string().trim().min(1).max(200),
                vatId: z.string().trim().min(4).max(32),
            })
            .strict()
            .optional(),
    })
    .strict();

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
            ErrorCode.SERVICE_UNAVAILABLE,
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

    const country = resolveRequestCountry((name) => request.headers.get(name));
    const waiverAt = new Date();

    try {
        const result = await startSubscriptionCheckout({
            userId: session.user.id,
            userEmail: session.user.email,
            userName: session.user.name ?? null,
            country,
            interval: parsed.data.interval,
            business: parsed.data.business,
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
        if (error instanceof VatIdVerificationError) {
            throw new AppError(ErrorCode.CONFLICT, error.message, 409, {
                code: error.code,
            });
        }
        throw error;
    }
});
