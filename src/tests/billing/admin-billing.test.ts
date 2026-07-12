import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, pricingMock } = vi.hoisted(() => ({
    dbMock: { execute: vi.fn() },
    pricingMock: { configuredProPriceIds: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/env", () => ({
    env: { BILLING_FOUNDING_MEMBER_CAPACITY: 100 },
}));
vi.mock("@/lib/hosted/billing/pricing", () => pricingMock);

import { billingOverview } from "@/db/queries/admin-billing";

describe("admin billing overview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pricingMock.configuredProPriceIds.mockReturnValue([
            "price_usd",
            "price_eur",
            "price_usd_year",
            "price_legacy",
        ]);
    });

    it("returns exact current-state billing metrics without merging currencies", async () => {
        dbMock.execute
            .mockResolvedValueOnce([
                {
                    totalUsers: 20,
                    proPlan: 12,
                    freePlan: 8,
                    inTrial: 3,
                    inGrace: 2,
                    foundingMembers: 4,
                    foundingSlotsClaimed: 10,
                    foundingSlotsReserved: 2,
                    foundingSlotsRemaining: 88,
                    activeSubscriptions: 9,
                    pastDueSubscriptions: 1,
                    cancelPendingSubscriptions: 2,
                    monthlySubscriptions: 8,
                    annualSubscriptions: 2,
                    firstPaymentsLast30Days: 5,
                },
            ])
            .mockResolvedValueOnce([
                {
                    amountCurrency: "EUR",
                    monthlyEquivalent: "40.00",
                    subscriptionCount: 8,
                },
                {
                    amountCurrency: "USD",
                    monthlyEquivalent: "25.00",
                    subscriptionCount: 5,
                },
            ])
            .mockResolvedValueOnce([
                {
                    stripePriceId: "price_unknown",
                    status: "active",
                    amountCurrency: "USD",
                    interval: "1 year",
                    subscriptionCount: 2,
                },
            ]);

        const overview = await billingOverview();

        expect(overview.counts.activeSubscriptions).toBe(9);
        expect(overview.counts.pastDueSubscriptions).toBe(1);
        expect(overview.counts.cancelPendingSubscriptions).toBe(2);
        expect(overview.counts.monthlySubscriptions).toBe(8);
        expect(overview.counts.annualSubscriptions).toBe(2);
        expect(overview.counts.firstPaymentsLast30Days).toBe(5);
        expect(overview.activeMrrByCurrency).toEqual([
            {
                amountCurrency: "EUR",
                monthlyEquivalent: "40.00",
                subscriptionCount: 8,
            },
            {
                amountCurrency: "USD",
                monthlyEquivalent: "25.00",
                subscriptionCount: 5,
            },
        ]);
        expect(overview.unknownLivePriceGroups).toEqual([
            {
                stripePriceId: "price_unknown",
                status: "active",
                amountCurrency: "USD",
                interval: "1 year",
                subscriptionCount: 2,
            },
        ]);
        expect(pricingMock.configuredProPriceIds).toHaveBeenCalledTimes(1);
        expect(dbMock.execute).toHaveBeenCalledTimes(3);
    });
});
