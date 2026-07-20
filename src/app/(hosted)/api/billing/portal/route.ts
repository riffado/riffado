import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    CheckoutPreconditionError,
    createBillingPortalSession,
} from "@/lib/hosted/billing/checkout";
import { isStripeConfigured } from "@/lib/hosted/billing/stripe-client";

const bodySchema = z.object({}).strict();

/**
 * Create a Stripe Billing Portal session and return its URL. The user
 * manages their payment method, invoices, and cancellation there.
 * Gated on `BILLING_ENABLED` + `IS_HOSTED` + Stripe config.
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
    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Invalid request body",
            400,
            { issues: parsed.error.flatten() },
        );
    }

    try {
        const url = await createBillingPortalSession({
            userId: session.user.id,
        });
        return NextResponse.json({ url });
    } catch (error) {
        if (
            error instanceof CheckoutPreconditionError &&
            error.code === "missing_portal_configuration"
        ) {
            throw new AppError(
                ErrorCode.SERVICE_UNAVAILABLE,
                error.message,
                503,
                { code: error.code },
            );
        }
        if (error instanceof CheckoutPreconditionError) {
            throw new AppError(ErrorCode.NOT_FOUND, error.message, 404, {
                code: error.code,
            });
        }
        throw error;
    }
});
