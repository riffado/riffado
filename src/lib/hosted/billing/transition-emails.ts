import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import {
    sendTransitionEndedEmail,
    sendTransitionReminderEmail,
    sendTransitionStartEmail,
} from "@/lib/notifications/email";
import { defaultCurrency, displayAmountForCurrency } from "./pricing";

const BATCH_LIMIT = 200;
const REMINDER_DAYS_OUT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const SELF_HOST_URL = "https://github.com/riffado/riffado#self-hosting";

// Cursor into the cohort, ordered by `users.id`. Without this, a cohort
// larger than BATCH_LIMIT would have the same first-200 rows re-selected
// every tick forever (already-sent emails no-op via dedup, but the row
// still occupies a batch slot), so users past the 200th never get their
// once-only start/reminder/ended emails. Wraps to the start once a tick
// returns fewer than BATCH_LIMIT rows (end of cohort reached), so every
// tick makes progress through the full cohort over time.
let cursorId: string | null = null;

export interface TransitionEmailResult {
    /** Launch-day start notices sent this run. */
    start: number;
    /** Pre-close reminders sent this run. */
    reminder: number;
    /** Read-only (window closed) notices sent this run. */
    ended: number;
    /** Per-user errors that didn't abort the batch. */
    errors: number;
}

/**
 * Worker tick: drive the grandfathered-cohort migration emails.
 *
 * The cohort is the set of pre-launch hosted users the backfill marked
 * `plan=hosted_free` with a `planTransitionUntil` and no deletion
 * scheduled. (Trial-lapsed users are also `hosted_free` but carry an
 * `accountDeletionScheduledAt` and get the grace emails instead, so the
 * `IS NULL` filter excludes them.) During the transition window these
 * users resolve to `hosted_pro` entitlements; when it closes they go
 * read-only with no deletion clock.
 *
 * Three once-only emails per user, keyed off `planTransitionUntil`:
 *   - start    : window open -> "hosted is now paid, you're free until X"
 *   - reminder : <= 3 days left -> "X days left, subscribe or self-host"
 *   - ended    : window closed -> "your account is now read-only"
 *
 * Sends are gated on `BILLING_LAUNCH_DATE` having arrived so the start
 * email can't fire early if the operator runs the backfill ahead of
 * launch. Dedup is handled by `claimEmailSend` (once-only per kind), so
 * re-runs across ticks are safe.
 */
export async function processTransitionEmails(): Promise<TransitionEmailResult> {
    let start = 0;
    let reminder = 0;
    let ended = 0;
    let errors = 0;

    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return { start, reminder, ended, errors };

    const launchIso = env.BILLING_LAUNCH_DATE;
    if (!launchIso) return { start, reminder, ended, errors };
    const launch = new Date(`${launchIso}T00:00:00Z`);
    const now = new Date();
    if (now < launch) return { start, reminder, ended, errors };

    // Grandfathered users have no chosen currency yet, so display the
    // default-currency price in the migration emails.
    const currency = defaultCurrency();
    const amountValue = displayAmountForCurrency(currency);
    const amountCurrency = currency.toUpperCase();
    const billingUrl = `${base}/settings#billing`;
    const exportUrl = `${base}/settings#export`;

    const baseFilter = and(
        eq(users.plan, "hosted_free"),
        isNotNull(users.planTransitionUntil),
        isNull(users.accountDeletionScheduledAt),
    );

    const fetchPage = (afterId: string | null) =>
        db
            .select({
                id: users.id,
                email: users.email,
                transitionUntil: users.planTransitionUntil,
            })
            .from(users)
            .where(
                afterId ? and(baseFilter, gt(users.id, afterId)) : baseFilter,
            )
            .orderBy(asc(users.id))
            .limit(BATCH_LIMIT);

    let cohort = await fetchPage(cursorId);

    // Nothing past the cursor -- we'd reached the end on a prior tick.
    // Wrap and fetch from the start so this tick still makes progress
    // instead of returning an empty batch.
    if (cohort.length === 0 && cursorId !== null) {
        cohort = await fetchPage(null);
    }

    // Advance the cursor past this batch; a short page (< BATCH_LIMIT)
    // means we've reached the true end of the cohort, so reset to null
    // rather than pointing past it (the next tick then wraps naturally).
    cursorId =
        cohort.length > 0 && cohort.length === BATCH_LIMIT
            ? cohort[cohort.length - 1].id
            : null;

    for (const row of cohort) {
        if (!row.email || !row.transitionUntil) continue;
        const msLeft = row.transitionUntil.getTime() - now.getTime();

        try {
            if (msLeft <= 0) {
                const sent = await sendTransitionEndedEmail({
                    userId: row.id,
                    email: row.email,
                    amountValue,
                    amountCurrency,
                    billingUrl,
                    exportUrl,
                    selfHostUrl: SELF_HOST_URL,
                });
                if (sent) ended += 1;
                continue;
            }

            // Window still open: the start email is once-only and fires on
            // the first in-window tick; the reminder is a separate key that
            // only sends inside the final stretch.
            const startSent = await sendTransitionStartEmail({
                userId: row.id,
                email: row.email,
                transitionEndsAt: row.transitionUntil,
                amountValue,
                amountCurrency,
                billingUrl,
                exportUrl,
                selfHostUrl: SELF_HOST_URL,
            });
            if (startSent) start += 1;

            if (msLeft <= REMINDER_DAYS_OUT * DAY_MS) {
                const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
                const reminderSent = await sendTransitionReminderEmail({
                    userId: row.id,
                    email: row.email,
                    daysLeft,
                    transitionEndsAt: row.transitionUntil,
                    amountValue,
                    amountCurrency,
                    billingUrl,
                    exportUrl,
                    selfHostUrl: SELF_HOST_URL,
                });
                if (reminderSent) reminder += 1;
            }
        } catch (error) {
            errors += 1;
            console.error(
                `[transition-emails] send failed for user ${row.id}:`,
                error,
            );
        }
    }

    return { start, reminder, ended, errors };
}
