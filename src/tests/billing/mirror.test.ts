import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    queriesMock,
    cycleCloseMock,
    graceMock,
    plansMock,
    stripeMock,
    emailMock,
    dbMock,
} = vi.hoisted(() => ({
    queriesMock: {
        getBillingCustomerByStripeId: vi.fn(),
        upsertSubscription: vi.fn(),
        setUserPlan: vi.fn(),
        markEverPaid: vi.fn(),
        clearAccountDeletion: vi.fn(),
        stampFoundingMember: vi.fn(),
        scheduleAccountDeletion: vi.fn(),
    },
    cycleCloseMock: { closeCycleForUser: vi.fn() },
    graceMock: {
        classifyGracePath: vi.fn().mockReturnValue("paid"),
        computeDeletionScheduledAt: vi
            .fn()
            .mockReturnValue(new Date("2026-08-01T00:00:00Z")),
        graceDaysForPath: vi.fn().mockReturnValue(30),
    },
    plansMock: {
        entitlementsForSubscription: vi.fn(),
        isWithinFoundingWindow: vi.fn().mockReturnValue(false),
        unixToDate: vi.fn().mockReturnValue(null),
    },
    stripeMock: {
        getStripe: vi.fn().mockReturnValue({
            customers: {
                retrieve: vi.fn().mockResolvedValue({ deleted: true }),
            },
        }),
    },
    emailMock: {
        sendGraceStartedEmail: vi.fn().mockResolvedValue(true),
        sendWelcomeHostedProEmail: vi.fn().mockResolvedValue(true),
    },
    dbMock: { select: vi.fn() },
}));

vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/cycle-close", () => cycleCloseMock);
vi.mock("@/lib/hosted/billing/grace", () => graceMock);
vi.mock("@/lib/hosted/billing/plans", () => plansMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => stripeMock);
vi.mock("@/lib/notifications/email", () => emailMock);
vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: {
        id: "id",
        email: "email",
        createdAt: "created_at",
        everPaidAt: "ever_paid_at",
    },
}));
vi.mock("@/lib/env", () => ({
    env: { APP_URL: "https://app.example.com", BILLING_PRO_DESCRIPTION: null },
}));

import { mirrorStripeSubscription } from "@/lib/hosted/billing/mirror";

function stubUserRow(row: Record<string, unknown>) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([row]),
            }),
        }),
    });
}

function sub(overrides: Partial<Stripe.Subscription>): Stripe.Subscription {
    return {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { userId: "u1" },
        items: {
            data: [
                {
                    price: {
                        id: "price_pro",
                        unit_amount: 500,
                        currency: "usd",
                    },
                },
            ],
        },
        cancel_at_period_end: false,
        canceled_at: null,
        start_date: 1_700_000_000,
        ...overrides,
    } as unknown as Stripe.Subscription;
}

describe("mirrorStripeSubscription", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        plansMock.isWithinFoundingWindow.mockReturnValue(false);
        queriesMock.scheduleAccountDeletion.mockResolvedValue(
            new Date("2026-08-01T00:00:00Z"),
        );
    });

    it("does not mark everPaidAt/founding-member/welcome-email for a trialing subscription", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        stubUserRow({ email: "u1@example.com", foundingMember: false });

        await mirrorStripeSubscription(sub({ status: "trialing" }));

        expect(queriesMock.setUserPlan).toHaveBeenCalledWith({
            userId: "u1",
            plan: "hosted_pro",
        });
        expect(queriesMock.clearAccountDeletion).toHaveBeenCalledWith("u1");
        expect(cycleCloseMock.closeCycleForUser).toHaveBeenCalledWith("u1");
        expect(queriesMock.markEverPaid).not.toHaveBeenCalled();
        expect(queriesMock.stampFoundingMember).not.toHaveBeenCalled();
        expect(emailMock.sendWelcomeHostedProEmail).not.toHaveBeenCalled();
    });

    it("marks everPaidAt and sends the welcome email for an active (paid) subscription", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        stubUserRow({ email: "u1@example.com", foundingMember: false });

        await mirrorStripeSubscription(sub({ status: "active" }));

        expect(queriesMock.markEverPaid).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1" }),
        );
        expect(emailMock.sendWelcomeHostedProEmail).toHaveBeenCalled();
    });

    it("demotes to free without scheduling deletion for a live status with an unrecognized price", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_free",
        });

        await mirrorStripeSubscription(
            sub({
                status: "active",
                items: { data: [{ price: { id: "price_unknown" } }] } as never,
            }),
        );

        expect(queriesMock.setUserPlan).toHaveBeenCalledWith({
            userId: "u1",
            plan: "hosted_free",
        });
        expect(queriesMock.scheduleAccountDeletion).not.toHaveBeenCalled();
    });

    it("schedules deletion and emails using the effective persisted date for a truly lapsed (canceled) subscription", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_free",
        });
        stubUserRow({
            email: "u1@example.com",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            everPaidAt: new Date("2026-01-05T00:00:00Z"),
        });
        // Effective date differs from what computeDeletionScheduledAt would
        // freshly compute -- simulates an earlier schedule already persisted.
        queriesMock.scheduleAccountDeletion.mockResolvedValue(
            new Date("2026-07-15T00:00:00Z"),
        );

        await mirrorStripeSubscription(sub({ status: "canceled" }));

        expect(queriesMock.scheduleAccountDeletion).toHaveBeenCalled();
        expect(emailMock.sendGraceStartedEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                deletionAt: new Date("2026-07-15T00:00:00Z"),
            }),
        );
    });
});
