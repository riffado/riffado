import { and, gt, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import {
    sendGraceLastDayEmail,
    sendGraceReminderEmail,
} from "@/lib/notifications/email";

const REMINDER_BATCH_LIMIT = 200;
const LAST_DAY_BATCH_LIMIT = 200;

const TRIAL_REMINDER_DAYS_OUT = 3;
const PAID_REMINDER_DAYS_OUT = 7;
const LAST_DAY_HOURS_OUT = 24;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface GraceReminderResult {
    /** Reminders sent this run. */
    reminders: number;
    /** Last-day notices sent this run. */
    lastDay: number;
    /** Per-user errors that didn't abort the batch. */
    errors: number;
}

/**
 * Worker tick: send the two mid-grace nudges -- a generic reminder and
 * a final 24-hour warning -- to users whose `accountDeletionScheduledAt`
 * is approaching.
 *
 * Reminder cadence is path-dependent because the grace windows differ:
 *
 *   - trial path (7d total): reminder at T-3, last-day at T-1
 *   - paid path  (30d total): reminder at T-7, last-day at T-1
 *
 * We can't tell the path from the row itself, so we widen the reminder
 * query to the larger window (paid, 7 days out) and filter in-memory
 * using the same `classifyGracePath` logic the lapse path uses
 * (everPaidAt OR pre-launch createdAt => paid; else trial).
 *
 * email_log dedup keys are scoped by deletionAt + daysLeft so a
 * reactivate + re-lapse cycle gets a fresh send, and so a user doesn't
 * receive the same reminder twice across worker ticks.
 */
export async function processGraceReminders(): Promise<GraceReminderResult> {
    let reminders = 0;
    let lastDay = 0;
    let errors = 0;

    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) return { reminders, lastDay, errors };

    const now = Date.now();
    const launchIso = env.BILLING_LAUNCH_DATE;
    const launch = launchIso ? new Date(`${launchIso}T00:00:00Z`) : null;

    const reminderCandidates = await db
        .select({
            id: users.id,
            email: users.email,
            createdAt: users.createdAt,
            everPaidAt: users.everPaidAt,
            deletionAt: users.accountDeletionScheduledAt,
        })
        .from(users)
        .where(
            and(
                isNotNull(users.accountDeletionScheduledAt),
                gt(users.accountDeletionScheduledAt, new Date(now)),
                lte(
                    users.accountDeletionScheduledAt,
                    new Date(now + PAID_REMINDER_DAYS_OUT * DAY_MS),
                ),
            ),
        )
        .limit(REMINDER_BATCH_LIMIT);

    for (const row of reminderCandidates) {
        if (!row.deletionAt || !row.email) continue;
        const msLeft = row.deletionAt.getTime() - now;
        const isPaidPath =
            row.everPaidAt !== null ||
            (launch !== null && row.createdAt < launch);
        const targetWindowMs = isPaidPath
            ? PAID_REMINDER_DAYS_OUT * DAY_MS
            : TRIAL_REMINDER_DAYS_OUT * DAY_MS;
        if (msLeft > targetWindowMs) continue;
        if (msLeft <= LAST_DAY_HOURS_OUT * HOUR_MS) continue;
        const daysLeft = Math.max(1, Math.round(msLeft / DAY_MS));
        try {
            const sent = await sendGraceReminderEmail({
                userId: row.id,
                email: row.email,
                daysLeft,
                deletionAt: row.deletionAt,
                exportUrl: `${base}/settings#export`,
                reactivateUrl: `${base}/settings#billing`,
            });
            if (sent) reminders += 1;
        } catch (error) {
            errors += 1;
            console.error(
                `[grace-reminders] reminder send failed for user ${row.id}:`,
                error,
            );
        }
    }

    const lastDayCandidates = await db
        .select({
            id: users.id,
            email: users.email,
            deletionAt: users.accountDeletionScheduledAt,
        })
        .from(users)
        .where(
            and(
                isNotNull(users.accountDeletionScheduledAt),
                gt(users.accountDeletionScheduledAt, new Date(now)),
                lte(
                    users.accountDeletionScheduledAt,
                    new Date(now + LAST_DAY_HOURS_OUT * HOUR_MS),
                ),
            ),
        )
        .limit(LAST_DAY_BATCH_LIMIT);

    for (const row of lastDayCandidates) {
        if (!row.deletionAt || !row.email) continue;
        try {
            const sent = await sendGraceLastDayEmail({
                userId: row.id,
                email: row.email,
                deletionAt: row.deletionAt,
                exportUrl: `${base}/settings#export`,
                reactivateUrl: `${base}/settings#billing`,
            });
            if (sent) lastDay += 1;
        } catch (error) {
            errors += 1;
            console.error(
                `[grace-reminders] last-day send failed for user ${row.id}:`,
                error,
            );
        }
    }

    return { reminders, lastDay, errors };
}
