import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    claimUsersDueForCycleClose,
    resetMynahCounterIfDue,
} from "@/db/queries/billing";
import { users } from "@/db/schema";
import { entitlementsForPlan, type PlanId } from "@/lib/entitlements";

/** 30 days in milliseconds. Rolling cycle, not calendar-month-aligned. */
export const CYCLE_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Refresh a single user's Mynah-seconds counter to the included amount
 * for their current plan, and push `monthlyMynahGrantResetAt` one cycle
 * forward.
 *
 * Idempotent: the DB update is gated on `monthlyMynahGrantResetAt IS NULL
 * OR <= now()`, so a concurrent worker that already closed the cycle
 * cannot double-grant. Returns true iff this caller did the write.
 *
 * Users with NULL plan are treated as `hosted_free` (matches
 * `getEntitlements`) so just-signed-up rows pick up the configured free
 * allotment on first contact.
 */
export async function closeCycleForUser(userId: string): Promise<boolean> {
    const rows = await db
        .select({ plan: users.plan })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (rows.length === 0) return false;

    const plan: PlanId = rows[0].plan ?? "hosted_free";
    const grant = entitlementsForPlan(plan).monthlyMynahSeconds;
    const nextResetAt = new Date(Date.now() + CYCLE_LENGTH_MS);

    return resetMynahCounterIfDue({
        userId,
        grantSeconds: grant,
        nextResetAt,
    });
}

/**
 * Worker tick: claim up to `limit` users whose cycle is due (or never
 * granted) and refresh each. Returns the number of cycles closed for
 * observability / tests.
 */
export async function closeDueCycles(limit = 200): Promise<number> {
    const ids = await claimUsersDueForCycleClose(limit);
    let closed = 0;
    for (const id of ids) {
        try {
            if (await closeCycleForUser(id)) closed += 1;
        } catch (error) {
            console.error(
                `[cycle-close] failed to close cycle for user ${id}:`,
                error,
            );
        }
    }
    return closed;
}
