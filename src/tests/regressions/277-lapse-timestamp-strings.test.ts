import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: `db.execute` returns raw driver rows, and on postgres-js a
// `timestamp` column arrives as a string. The `db.execute<Shape>()` generic
// is an unchecked assertion, so `Date`-typed fields type-checked fine and
// then threw `lapseAt.getTime is not a function` inside the billing worker's
// trial-lapse phase -- once per expired trial, every tick, caught by a
// per-user handler that only logged to the container. No trial ever lapsed.
// These tests feed the query layer what the driver actually returns.

const { dbMock } = vi.hoisted(() => ({
    dbMock: { execute: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/env", () => ({
    env: {
        BILLING_TRIAL_GRACE_DAYS: 7,
        BILLING_PAID_GRACE_DAYS: 30,
        BILLING_LAUNCH_DATE: "2026-07-21",
    },
}));
vi.mock("@/db/schema", () => ({
    billingCustomers: { userId: "user_id" },
    foundingMemberReservations: {
        id: "id",
        status: "status",
        stripeCheckoutSessionId: "stripe_checkout_session_id",
        expiresAt: "expires_at",
        consumedAt: "consumed_at",
        userId: "user_id",
    },
    recordings: { userId: "user_id", filesize: "filesize" },
    stripeWebhookEvents: { eventId: "event_id" },
    subscriptions: { status: "status", updatedAt: "updated_at" },
    users: {
        id: "id",
        plan: "plan",
        accountDeletionScheduledAt: "account_deletion_scheduled_at",
        monthlyMynahGrantResetAt: "monthly_mynah_grant_reset_at",
    },
}));

import {
    claimDueStripeWebhookEvents,
    claimUsersWithExpiredTrials,
    listFoundingReservationsForExpiryCheck,
    listSubscriptionsForReconcile,
} from "@/db/queries/billing";
import {
    classifyGracePath,
    computeDeletionScheduledAt,
} from "@/lib/hosted/billing/grace";

describe("raw db.execute timestamp coercion", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("claimUsersWithExpiredTrials returns Dates for string timestamps", async () => {
        dbMock.execute.mockResolvedValue([
            {
                id: "u_1",
                created_at: "2026-07-21 21:14:45.57",
                ever_paid_at: null,
                plan_transition_until: "2026-08-04 21:14:47.196",
            },
        ]);

        const [row] = await claimUsersWithExpiredTrials(100);

        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.planTransitionUntil).toBeInstanceOf(Date);
        expect(row.everPaidAt).toBeNull();
        expect(row.planTransitionUntil?.getTime()).toBe(
            new Date("2026-08-04 21:14:47.196").getTime(),
        );
    });

    it("claimUsersWithExpiredTrials passes Dates through unchanged", async () => {
        const createdAt = new Date("2026-07-21T21:14:45.570Z");
        const planTransitionUntil = new Date("2026-08-04T21:14:47.196Z");
        dbMock.execute.mockResolvedValue([
            {
                id: "u_1",
                created_at: createdAt,
                ever_paid_at: null,
                plan_transition_until: planTransitionUntil,
            },
        ]);

        const [row] = await claimUsersWithExpiredTrials(100);

        expect(row.createdAt.getTime()).toBe(createdAt.getTime());
        expect(row.planTransitionUntil?.getTime()).toBe(
            planTransitionUntil.getTime(),
        );
    });

    it("listSubscriptionsForReconcile returns a Date for updatedAt", async () => {
        dbMock.execute.mockResolvedValue([
            {
                id: "sub_1",
                stripe_customer_id: "cus_1",
                status: "active",
                updated_at: "2026-08-01 10:00:00",
            },
        ]);

        const [row] = await listSubscriptionsForReconcile({
            limit: 10,
            staleAfterSeconds: 3600,
        });

        expect(row.updatedAt).toBeInstanceOf(Date);
    });

    it("listFoundingReservationsForExpiryCheck returns a Date for expiresAt", async () => {
        dbMock.execute.mockResolvedValue([
            {
                id: "res_1",
                stripe_checkout_session_id: "cs_1",
                expires_at: "2026-08-01 10:00:00",
            },
        ]);

        const [row] = await listFoundingReservationsForExpiryCheck({
            limit: 10,
            now: new Date("2026-08-02T00:00:00Z"),
        });

        expect(row.expiresAt).toBeInstanceOf(Date);
    });

    it("claimUsersWithExpiredTrials survives the full lapse math on string input", async () => {
        dbMock.execute.mockResolvedValue([
            {
                id: "u_1",
                created_at: "2026-07-21 21:14:45.57",
                ever_paid_at: null,
                plan_transition_until: "2026-08-04 21:14:47.196",
            },
        ]);

        const [row] = await claimUsersWithExpiredTrials(100);

        // This is the exact expression that threw in production:
        // `TypeError: lapseAt.getTime is not a function`.
        expect(() =>
            computeDeletionScheduledAt({
                lapseAt: row.planTransitionUntil ?? new Date(),
                path: classifyGracePath({
                    createdAt: row.createdAt,
                    everPaidAt: row.everPaidAt,
                }),
            }),
        ).not.toThrow();
    });

    it("claimDueStripeWebhookEvents returns a Date for eventCreatedAt", async () => {
        dbMock.execute.mockResolvedValue([
            {
                event_id: "evt_1",
                type: "checkout.session.completed",
                event_created_at: "2026-08-01 10:00:00",
                payload: {},
                attempts: 0,
                claim_token: "tok_1",
            },
        ]);

        const [row] = await claimDueStripeWebhookEvents({
            limit: 10,
            processingLeaseMs: 60_000,
        });

        // webhook-inbox.ts calls `.getTime()` on this to rebuild the Stripe
        // event, so a string here breaks every inbox delivery.
        expect(row.eventCreatedAt).toBeInstanceOf(Date);
        expect(() => row.eventCreatedAt.getTime()).not.toThrow();
    });
});
