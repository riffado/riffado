import { NextResponse } from "next/server";
import { scheduleAccountDeletion } from "@/db/queries/billing";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

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
 */
export const POST = apiHandler(async (request) => {
    if (!env.IS_HOSTED || !env.BILLING_ENABLED) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const session = await requireApiSession(request);
    await scheduleAccountDeletion({
        userId: session.user.id,
        scheduledAt: new Date(),
        force: true,
    });
    return NextResponse.json({ ok: true });
});
