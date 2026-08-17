import {
    claimUsersWithExpiredTransition,
    scheduleAccountDeletion,
} from "@/db/queries/billing";
import { captureServerException } from "@/lib/posthog-server";
import { GRANDFATHERED_GRACE_DAYS } from "./grace";

const DEFAULT_BATCH_LIMIT = 100;

export interface GrandfatherLapseResult {
    /** Users given a deletion clock this run. */
    scheduled: number;
    /** How many threw (counted but did not abort the run). */
    errors: number;
}

/**
 * Start the deletion clock for grandfathered pre-launch users whose
 * transition window has closed.
 *
 * The trial path (`processExpiredTrials`) cannot cover this cohort: it
 * claims `plan = 'hosted_pro'` rows, and the backfill put these users on
 * `hosted_free` with a `planTransitionUntil` instead. They were therefore
 * claimed by nothing at all -- locked out on schedule by `getEntitlements`,
 * but with their data retained forever and no grace machinery attached.
 *
 * No plan write here: `hosted_free` is already the lockout state, so the
 * only missing piece is `accountDeletionScheduledAt`, which is what makes
 * the deletion worker and the grace reminders see them.
 *
 * Grace runs from now, not from the window end, for the same reason the
 * trial path floors it at now: this phase can be late, and a window that
 * closed before the clock started must not shorten the notice anyone gets.
 *
 * No email is sent here. `processTransitionEmails` owns the "your window
 * closed, you're read-only" notice for this cohort, and the claim requires
 * that notice to already be logged -- so users are told first, and the
 * `grace-reminders` phase handles the T-7 and T-1 warnings off the
 * timestamp this phase writes.
 */
export async function processExpiredTransitions(options?: {
    limit?: number;
}): Promise<GrandfatherLapseResult> {
    const limit = options?.limit ?? DEFAULT_BATCH_LIMIT;
    const candidates = await claimUsersWithExpiredTransition(limit);

    let scheduled = 0;
    let errors = 0;
    for (const row of candidates) {
        try {
            const graceStartsAt = new Date();
            await scheduleAccountDeletion({
                userId: row.id,
                scheduledAt: new Date(
                    graceStartsAt.getTime() +
                        GRANDFATHERED_GRACE_DAYS * 24 * 60 * 60 * 1000,
                ),
            });
            scheduled += 1;
        } catch (error) {
            errors += 1;
            console.error(
                `[billing-grandfather] failed to schedule deletion for user ${row.id}:`,
                error,
            );
            captureServerException(error, {
                source: "worker:billing",
                phase: "grandfather-lapse",
                distinctId: row.id,
            });
        }
    }

    return { scheduled, errors };
}
