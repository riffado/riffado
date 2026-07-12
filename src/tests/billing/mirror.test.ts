import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    queriesMock,
    cycleCloseMock,
    graceMock,
    plansMock,
    stripeMock,
    pricingMock,
    emailMock,
    dbMock,
} = vi.hoisted(() => ({
    queriesMock: {
        consumeFoundingMemberReservation: vi.fn(),
        getBillingCustomerByStripeId: vi.fn(),
        upsertSubscription: vi.fn(),
        setUserPlan: vi.fn(),
        markEverPaid: vi.fn(),
        releaseFoundingMemberReservation: vi.fn(),
        clearAccountDeletion: vi.fn(),
        forfeitFoundingMember: vi.fn(),
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
        unixToDate: vi.fn((seconds: number | null | undefined) =>
            seconds ? new Date(seconds * 1000) : null,
        ),
    },
    stripeMock: {
        getStripe: vi.fn().mockReturnValue({
            customers: {
                retrieve: vi.fn().mockResolvedValue({ deleted: true }),
            },
            subscriptions: {
                update: vi.fn().mockResolvedValue({}),
            },
        }),
    },
    pricingMock: {
        isFoundingMonthlyPriceId: vi.fn().mockReturnValue(false),
        isProPriceId: vi.fn().mockReturnValue(true),
        resolveStandardMonthlyPriceForCurrency: vi
            .fn()
            .mockReturnValue({ priceId: "price_standard" }),
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
vi.mock("@/lib/hosted/billing/pricing", () => pricingMock);
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
    env: {
        APP_URL: "https://app.example.com",
        BILLING_PRO_DESCRIPTION: null,
        BILLING_FOUNDING_MEMBER_CAPACITY: 100,
    },
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
        pricingMock.isFoundingMonthlyPriceId.mockReturnValue(false);
        pricingMock.isProPriceId.mockReturnValue(true);
        queriesMock.markEverPaid.mockResolvedValue(true);
        queriesMock.consumeFoundingMemberReservation.mockResolvedValue(true);
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
        expect(
            queriesMock.consumeFoundingMemberReservation,
        ).not.toHaveBeenCalled();
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
        expect(emailMock.sendWelcomeHostedProEmail).toHaveBeenCalledWith(
            expect.objectContaining({ interval: "month" }),
        );
    });

    it("mirrors but does not mutate plan or run side effects for a live status with an unrecognized price", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_free",
        });
        pricingMock.isProPriceId.mockReturnValue(false);

        await mirrorStripeSubscription(
            sub({
                status: "active",
                items: { data: [{ price: { id: "price_unknown" } }] } as never,
            }),
        );

        expect(queriesMock.upsertSubscription).toHaveBeenCalled();
        expect(queriesMock.setUserPlan).not.toHaveBeenCalled();
        expect(queriesMock.clearAccountDeletion).not.toHaveBeenCalled();
        expect(cycleCloseMock.closeCycleForUser).not.toHaveBeenCalled();
        expect(queriesMock.scheduleAccountDeletion).not.toHaveBeenCalled();
    });

    it("consumes founding reservations only for paid founding monthly subscriptions", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        pricingMock.isFoundingMonthlyPriceId.mockReturnValue(true);
        stubUserRow({ email: "u1@example.com", foundingMember: false });

        await mirrorStripeSubscription(
            sub({
                status: "active",
                items: {
                    data: [
                        {
                            price: {
                                id: "price_pro_year",
                                unit_amount: 5000,
                                currency: "usd",
                                recurring: {
                                    interval_count: 1,
                                    interval: "year",
                                },
                            },
                        },
                    ],
                } as never,
            }),
        );

        expect(
            queriesMock.consumeFoundingMemberReservation,
        ).not.toHaveBeenCalled();
        expect(emailMock.sendWelcomeHostedProEmail).toHaveBeenCalledWith(
            expect.objectContaining({ interval: "year" }),
        );

        await mirrorStripeSubscription(
            sub({
                status: "active",
                metadata: { userId: "u1", foundingReservationId: "fmr_1" },
                items: {
                    data: [
                        {
                            price: {
                                id: "price_pro_month",
                                unit_amount: 500,
                                currency: "usd",
                                recurring: {
                                    interval_count: 1,
                                    interval: "month",
                                },
                            },
                        },
                    ],
                } as never,
            }),
        );

        expect(
            queriesMock.consumeFoundingMemberReservation,
        ).toHaveBeenCalledWith({
            reservationId: "fmr_1",
            userId: "u1",
            stripePriceId: "price_pro_month",
            paidAt: new Date(1_700_000_000 * 1000),
        });
    });

    it("still validates founding reservation on remirror when this is not the first payment", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        pricingMock.isFoundingMonthlyPriceId.mockReturnValue(true);
        queriesMock.markEverPaid.mockResolvedValue(false);
        stubUserRow({ email: "u1@example.com", foundingMember: false });

        await mirrorStripeSubscription(
            sub({
                status: "active",
                metadata: { userId: "u1", foundingReservationId: "fmr_1" },
                items: {
                    data: [
                        {
                            price: {
                                id: "price_pro_month",
                                unit_amount: 500,
                                currency: "usd",
                                recurring: {
                                    interval_count: 1,
                                    interval: "month",
                                },
                            },
                        },
                    ],
                } as never,
            }),
        );

        expect(
            queriesMock.consumeFoundingMemberReservation,
        ).toHaveBeenCalledWith({
            reservationId: "fmr_1",
            userId: "u1",
            stripePriceId: "price_pro_month",
            paidAt: new Date(1_700_000_000 * 1000),
        });
    });

    it("preserves founding pricing while cancellation is only scheduled", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        pricingMock.isFoundingMonthlyPriceId.mockReturnValue(true);
        stubUserRow({ email: "u1@example.com", foundingMember: true });

        await mirrorStripeSubscription(
            sub({
                status: "active",
                cancel_at_period_end: true,
                items: {
                    data: [
                        {
                            id: "si_1",
                            current_period_end: 1_800_000_000,
                            price: {
                                id: "price_pro_month",
                                unit_amount: 500,
                                currency: "usd",
                                recurring: {
                                    interval_count: 1,
                                    interval: "month",
                                },
                            },
                        },
                    ],
                } as never,
            }),
        );

        expect(queriesMock.forfeitFoundingMember).not.toHaveBeenCalled();
        expect(queriesMock.consumeFoundingMemberReservation).toHaveBeenCalled();
    });

    it("moves an unreserved founding monthly subscription to standard monthly", async () => {
        plansMock.entitlementsForSubscription.mockReturnValue({
            plan: "hosted_pro",
        });
        pricingMock.isFoundingMonthlyPriceId.mockImplementation(
            (priceId: string) => priceId === "price_pro_month",
        );
        queriesMock.consumeFoundingMemberReservation.mockResolvedValue(false);
        stubUserRow({ email: "u1@example.com", foundingMember: false });
        const foundingSubscription = sub({
            status: "active",
            metadata: { userId: "u1", foundingReservationId: "fmr_1" },
            items: {
                data: [
                    {
                        id: "si_1",
                        price: {
                            id: "price_pro_month",
                            unit_amount: 500,
                            currency: "usd",
                            recurring: {
                                interval_count: 1,
                                interval: "month",
                            },
                        },
                    },
                ],
            } as never,
        });
        stripeMock.getStripe().subscriptions.update.mockResolvedValueOnce(
            sub({
                status: "active",
                items: {
                    data: [
                        {
                            id: "si_1",
                            price: {
                                id: "price_standard",
                                unit_amount: 900,
                                currency: "usd",
                                recurring: {
                                    interval_count: 1,
                                    interval: "month",
                                },
                            },
                        },
                    ],
                } as never,
            }),
        );

        await mirrorStripeSubscription(foundingSubscription);

        expect(
            stripeMock.getStripe().subscriptions.update,
        ).toHaveBeenCalledWith("sub_1", {
            items: [{ id: "si_1", price: "price_standard" }],
            proration_behavior: "none",
        });
        expect(
            queriesMock.releaseFoundingMemberReservation,
        ).toHaveBeenCalledWith({
            reservationId: "fmr_1",
            releasedAt: expect.any(Date),
        });
        expect(emailMock.sendWelcomeHostedProEmail).toHaveBeenCalledWith(
            expect.objectContaining({ amountValue: "9.00" }),
        );
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
