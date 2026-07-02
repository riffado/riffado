import { env } from "@/lib/env";
import { closeDueCycles } from "./cycle-close";
import { processDueAccountDeletions } from "./deletion";
import { processGraceReminders } from "./grace-reminders";
import { processExpiredTrials } from "./lapse";
import { reconcileStaleSubscriptions } from "./reconcile";
import { processTransitionEmails } from "./transition-emails";

const TICK_MS = 5 * 60 * 1000;
const RECONCILE_EVERY_N_TICKS = 6;

let started = false;
let running = false;
let tickCount = 0;

async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const closed = await closeDueCycles();
        if (closed > 0) {
            console.log(`[billing-worker] closed ${closed} cycle(s)`);
        }

        const lapse = await processExpiredTrials();
        if (lapse.lapsed > 0 || lapse.errors > 0) {
            console.log(
                `[billing-worker] trial-lapse lapsed=${lapse.lapsed} errors=${lapse.errors}`,
            );
        }

        const deletion = await processDueAccountDeletions();
        if (deletion.deleted > 0 || deletion.errors > 0) {
            console.log(
                `[billing-worker] deletion deleted=${deletion.deleted} storage_partial=${deletion.storagePartial} errors=${deletion.errors}`,
            );
        }

        const reminders = await processGraceReminders();
        if (
            reminders.reminders > 0 ||
            reminders.lastDay > 0 ||
            reminders.errors > 0
        ) {
            console.log(
                `[billing-worker] grace-reminders reminders=${reminders.reminders} last_day=${reminders.lastDay} errors=${reminders.errors}`,
            );
        }

        const transition = await processTransitionEmails();
        if (
            transition.start > 0 ||
            transition.reminder > 0 ||
            transition.ended > 0 ||
            transition.errors > 0
        ) {
            console.log(
                `[billing-worker] transition-emails start=${transition.start} reminder=${transition.reminder} ended=${transition.ended} errors=${transition.errors}`,
            );
        }

        tickCount += 1;
        if (tickCount % RECONCILE_EVERY_N_TICKS === 0) {
            const result = await reconcileStaleSubscriptions();
            if (result.inspected > 0 || result.errors > 0) {
                console.log(
                    `[billing-worker] reconcile inspected=${result.inspected} errors=${result.errors}`,
                );
            }
        }
    } catch (error) {
        console.error("[billing-worker] tick failed:", error);
    } finally {
        running = false;
    }
}

/**
 * Start the hosted billing background worker. No-ops on self-host
 * (`!env.IS_HOSTED`) and when `BILLING_ENABLED` is not true. Called from
 * `instrumentation.ts` at process boot; safe to call more than once
 * (subsequent calls return immediately).
 *
 * Each tick (every 5 minutes):
 *  - Closes due Mynah cycles
 *  - Detects expired trials with no card -> demotes + schedules deletion
 *  - Processes accounts whose grace window has elapsed -> hard delete
 *  - Drives the grandfathered-cohort transition emails (start / reminder
 *    / ended) once the configured launch date has arrived
 *
 * Every sixth tick (~30 minutes) additionally runs subscription
 * reconciliation against Stripe to catch drift from missed webhooks.
 */
export function startBillingWorker(): void {
    if (started) return;
    if (!env.IS_HOSTED || !env.BILLING_ENABLED) return;
    started = true;
    const interval = setInterval(() => {
        void tick();
    }, TICK_MS);
    interval.unref?.();
    void tick();
}
