import { NextResponse } from "next/server";
import { scheduleAccountDeletion } from "@/db/queries/billing";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { cancelSubscriptionImmediatelyForDeletion } from "@/lib/hosted/billing/checkout";
import { isStripeConfigured } from "@/lib/hosted/billing/stripe-client";

/**
 * Cancel any live hosted subscription, then queue permanent account deletion.
 * The worker performs storage cleanup and the final user-row deletion. Stripe
 * cancellation must succeed before the deletion timestamp is written.
 */
export const POST = apiHandler(async (request) => {
    if (!env.IS_HOSTED || !env.BILLING_ENABLED) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isStripeConfigured()) {
        throw new AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Billing is not configured on this instance",
            503,
        );
    }
    const session = await requireApiSession(request);

    await cancelSubscriptionImmediatelyForDeletion(session.user.id);
    await scheduleAccountDeletion({
        userId: session.user.id,
        scheduledAt: new Date(),
        force: true,
    });
    return NextResponse.json({ ok: true });
});
