import type Stripe from "stripe";
import {
    claimDueStripeWebhookEvents,
    completeStripeWebhookEvent,
    completeStripeWebhookEventUnderLock,
    failStripeWebhookEvent,
    renewStripeWebhookEventClaim,
    withStripeWebhookEventLock,
} from "@/db/queries/billing";
import { captureServerException } from "@/lib/posthog-server";
import { handleStripeWebhook } from "./webhook";

const MAX_EVENTS_PER_TICK = 20;
const MAX_ATTEMPTS = 5;
const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const CLAIM_RENEWAL_MS = PROCESSING_LEASE_MS / 3;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

function retryAtForAttempt(attempt: number): Date {
    const delay = Math.min(
        RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
        RETRY_MAX_MS,
    );
    return new Date(Date.now() + delay);
}

function eventFromInboxRow(row: {
    eventId: string;
    type: string;
    eventCreatedAt: Date;
    payload: Record<string, unknown>;
}): Stripe.Event {
    return {
        id: row.eventId,
        type: row.type,
        created: Math.floor(row.eventCreatedAt.getTime() / 1000),
        data: { object: row.payload },
    } as unknown as Stripe.Event;
}

async function processEvent(row: {
    eventId: string;
    type: string;
    eventCreatedAt: Date;
    payload: Record<string, unknown>;
    attempts: number;
    claimToken: string;
}): Promise<{ completed: number; retried: number; failed: number }> {
    return withStripeWebhookEventLock(row.eventId, async () => {
        let renewing = false;
        let claimLost = false;
        const renew = async (): Promise<boolean> => {
            if (renewing) return !claimLost;
            renewing = true;
            try {
                const renewed = await renewStripeWebhookEventClaim({
                    eventId: row.eventId,
                    claimToken: row.claimToken,
                    processingLeaseMs: PROCESSING_LEASE_MS,
                });
                claimLost = !renewed;
                return renewed;
            } catch (error) {
                claimLost = true;
                console.error(
                    `[stripe-webhook-inbox] failed to renew claim for ${row.eventId}:`,
                    error,
                );
                return false;
            } finally {
                renewing = false;
            }
        };

        if (!(await renew())) return { completed: 0, retried: 0, failed: 0 };
        const renewal = setInterval(() => {
            void renew();
        }, CLAIM_RENEWAL_MS);
        renewal.unref?.();

        try {
            await handleStripeWebhook(eventFromInboxRow(row));
            const completed =
                claimLost || !(await renew())
                    ? await completeStripeWebhookEventUnderLock(row.eventId)
                    : await completeStripeWebhookEvent({
                          eventId: row.eventId,
                          claimToken: row.claimToken,
                      });
            return { completed: completed ? 1 : 0, retried: 0, failed: 0 };
        } catch (error) {
            if (claimLost) return { completed: 0, retried: 0, failed: 0 };
            const message =
                error instanceof Error ? error.message : String(error);
            const outcome = await failStripeWebhookEvent({
                eventId: row.eventId,
                claimToken: row.claimToken,
                errorMessage: message,
                maxAttempts: MAX_ATTEMPTS,
                retryAt: retryAtForAttempt(row.attempts + 1),
            });
            if (!outcome) return { completed: 0, retried: 0, failed: 0 };
            if (outcome.status === "failed") {
                console.error(
                    `[stripe-webhook-inbox] event ${row.eventId} failed permanently after ${outcome.attempts} attempt(s):`,
                    error,
                );
                captureServerException(error, {
                    source: "worker:billing-webhook-inbox",
                    eventId: row.eventId,
                    eventType: row.type,
                    attempts: outcome.attempts,
                });
                return { completed: 0, retried: 0, failed: 1 };
            }
            console.warn(
                `[stripe-webhook-inbox] event ${row.eventId} failed attempt ${outcome.attempts}/${MAX_ATTEMPTS}; requeued`,
                error,
            );
            return { completed: 0, retried: 1, failed: 0 };
        } finally {
            clearInterval(renewal);
        }
    });
}

export interface StripeWebhookInboxResult {
    claimed: number;
    completed: number;
    retried: number;
    failed: number;
}

/** Process one bounded batch of durably accepted Stripe events. */
export async function processStripeWebhookInbox(): Promise<StripeWebhookInboxResult> {
    const events = await claimDueStripeWebhookEvents({
        limit: MAX_EVENTS_PER_TICK,
        processingLeaseMs: PROCESSING_LEASE_MS,
    });
    const result: StripeWebhookInboxResult = {
        claimed: events.length,
        completed: 0,
        retried: 0,
        failed: 0,
    };
    for (const event of events) {
        const outcome = await processEvent(event);
        result.completed += outcome.completed;
        result.retried += outcome.retried;
        result.failed += outcome.failed;
    }
    return result;
}
