import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    claimUsersWithExpiredTrials,
    scheduleAccountDeletion,
    setUserPlan,
} from "@/db/queries/billing";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { sendGraceStartedEmail } from "@/lib/notifications/email";
import {
    classifyGracePath,
    computeDeletionScheduledAt,
    graceDaysForPath,
} from "./grace";

const DEFAULT_BATCH_LIMIT = 100;

export interface LapseResult {
    /** Users transitioned from hosted_pro -> hosted_free this run. */
    lapsed: number;
    /** How many threw (counted but did not abort the run). */
    errors: number;
}

/**
 * Walk hosted_pro users whose trial window has elapsed without producing
 * an active Stripe subscription (the no-card trial path). For each:
 *
 *   1. Demote to `hosted_free` (the lockout state -- read-only, no sync,
 *      no transcription).
 *   2. Schedule the account for hard deletion at lapse + grace days,
 *      where the grace window is decided by `classifyGracePath`
 *      (grandfathered pre-launch users get the longer paid window).
 *
 * Idempotent: `scheduleAccountDeletion` keeps the earlier timestamp by
 * default, so a re-claim after the next worker tick won't push deletion
 * out. Errors are per-user and don't abort the batch.
 */
export async function processExpiredTrials(options?: {
    limit?: number;
}): Promise<LapseResult> {
    const limit = options?.limit ?? DEFAULT_BATCH_LIMIT;
    const candidates = await claimUsersWithExpiredTrials(limit);

    let lapsed = 0;
    let errors = 0;
    for (const row of candidates) {
        try {
            const path = classifyGracePath({
                createdAt: row.createdAt,
                everPaidAt: row.everPaidAt,
            });
            const lapseAt = row.planTransitionUntil ?? new Date();
            const scheduledAt = computeDeletionScheduledAt({ lapseAt, path });

            await setUserPlan({ userId: row.id, plan: "hosted_free" });
            await scheduleAccountDeletion({
                userId: row.id,
                scheduledAt,
            });
            await sendGraceStartedNotice({
                userId: row.id,
                path,
                scheduledAt,
            });
            lapsed += 1;
        } catch (error) {
            errors += 1;
            console.error(
                `[billing-lapse] failed to lapse user ${row.id}:`,
                error,
            );
        }
    }

    return { lapsed, errors };
}

async function sendGraceStartedNotice(input: {
    userId: string;
    path: "trial" | "paid";
    scheduledAt: Date;
}): Promise<void> {
    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return;
    const [row] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
    if (!row?.email) return;
    try {
        await sendGraceStartedEmail({
            userId: input.userId,
            email: row.email,
            gracePath: input.path,
            graceDays: graceDaysForPath(input.path),
            deletionAt: input.scheduledAt,
            exportUrl: `${base}/settings#export`,
            reactivateUrl: `${base}/settings#billing`,
        });
    } catch (error) {
        console.error(
            `[billing-lapse] grace-started email failed for user ${input.userId}:`,
            error,
        );
    }
}
