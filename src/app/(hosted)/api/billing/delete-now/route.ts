import { NextResponse } from "next/server";
import {
    getUserBillingState,
    scheduleAccountDeletion,
} from "@/db/queries/billing";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * Self-serve "skip the grace window and delete me now" action.
 *
 * Behavior: stamps `accountDeletionScheduledAt = now()` (force=true so
 * it overrides any future scheduled deletion), and the billing worker
 * picks it up on the next tick (within 5 minutes). The actual delete
 * runs in the worker, not inline, so the request returns immediately
 * and the worker's R2-cleanup + account-deleted email path runs as a
 * normal scheduled-deletion event.
 *
 * Self-host (`!IS_HOSTED`) and billing-off return 404 so this surface
 * is invisible when not applicable -- matches the three-layer refusal
 * pattern used by the rest of the (hosted) billing UI.
 *
 * Only callable once the account is already in a grace window
 * (`accountDeletionScheduledAt` already set by the lapse/mirror
 * workflow) -- this mirrors the same `state.grace !== null` gate the
 * Settings UI uses to show the "Delete now" button in the first place.
 * An active subscriber calling this endpoint directly (bypassing the
 * UI) would otherwise get hard-deleted while Stripe billing continues
 * uninterrupted, since this route never touches the Stripe
 * subscription.
 */
export const POST = apiHandler(async (request) => {
    if (!env.IS_HOSTED || !env.BILLING_ENABLED) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const session = await requireApiSession(request);

    const state = await getUserBillingState(session.user.id);
    if (!state?.accountDeletionScheduledAt) {
        throw new AppError(
            ErrorCode.CONFLICT,
            "Account is not in a deletion grace period. Cancel your subscription first.",
            409,
        );
    }

    await scheduleAccountDeletion({
        userId: session.user.id,
        scheduledAt: new Date(),
        force: true,
    });
    return NextResponse.json({ ok: true });
});
