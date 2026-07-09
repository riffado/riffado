import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { canStoreMoreBytes } from "@/lib/hosted/billing/enforcement";
import { sendOverCapEmail } from "@/lib/notifications/email";

export interface StorageCapDecision {
    allowed: boolean;
    currentBytes: number;
    /** `null` when the plan has no storage cap (self-host / unlimited). */
    limitBytes: number | null;
}

/**
 * Gate a pending write of `additionalBytes` against the user's storage
 * cap. Returns `allowed: true` immediately on self-host / uncapped plans.
 *
 * On a hosted over-cap decision this also fires the once-only over-cap
 * email (best-effort, deduped via `email_log`) so the user learns why
 * their sync or upload stopped. Email failure never flips the decision.
 */
export async function enforceStorageCap(input: {
    userId: string;
    additionalBytes: number;
}): Promise<StorageCapDecision> {
    const check = await canStoreMoreBytes(input.userId, input.additionalBytes);
    if (check.allowed || check.limitBytes === null) {
        return {
            allowed: check.allowed,
            currentBytes: check.currentBytes,
            limitBytes: check.limitBytes,
        };
    }

    try {
        const [user] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);
        if (user?.email) {
            const base = env.APP_URL;
            await sendOverCapEmail({
                userId: input.userId,
                email: user.email,
                billingUrl: `${base}/settings#billing`,
                settingsUrl: `${base}/settings#storage`,
                currentBytes: check.currentBytes,
                limitBytes: check.limitBytes,
            });
        }
    } catch (error) {
        console.error(
            `[storage-cap] over-cap email failed for user ${input.userId}:`,
            error,
        );
    }

    return {
        allowed: false,
        currentBytes: check.currentBytes,
        limitBytes: check.limitBytes,
    };
}
