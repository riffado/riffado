import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    CheckoutPreconditionError,
    cancelSubscription,
} from "@/lib/hosted/billing/checkout";
import { isStripeConfigured } from "@/lib/hosted/billing/stripe-client";

/**
 * Cancel the current user's hosted Pro subscription. Marks the local
 * Stripe subscription to cancel at period end; the user keeps Pro access
 * through the current paid period (mirrored locally via `nextPaymentAt`).
 * Most users cancel via the Customer Portal -- this is the fallback.
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

    try {
        await cancelSubscription(session.user.id);
    } catch (error) {
        if (
            error instanceof CheckoutPreconditionError &&
            error.code === "missing_subscription"
        ) {
            throw new AppError(
                ErrorCode.NOT_FOUND,
                "No subscription to cancel",
                404,
            );
        }
        if (error instanceof CheckoutPreconditionError) {
            throw new AppError(ErrorCode.CONFLICT, error.message, 409, {
                code: error.code,
            });
        }
        throw error;
    }

    return NextResponse.json({ ok: true });
});
