import { beforeEach, describe, expect, it, vi } from "vitest";

const { mirrorMock, queriesMock } = vi.hoisted(() => ({
    mirrorMock: { mirrorSubscriptionById: vi.fn() },
    queriesMock: { listSubscriptionsForReconcile: vi.fn() },
}));

vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/mirror", () => mirrorMock);

import { reconcileStaleSubscriptions } from "@/lib/hosted/billing/reconcile";

describe("reconcileStaleSubscriptions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns inspected=0/errors=0 when no stale subscriptions", async () => {
        queriesMock.listSubscriptionsForReconcile.mockResolvedValue([]);
        const result = await reconcileStaleSubscriptions();
        expect(result).toEqual({ inspected: 0, errors: 0 });
        expect(mirrorMock.mirrorSubscriptionById).not.toHaveBeenCalled();
    });

    it("calls mirrorSubscriptionById for each stale row by id", async () => {
        queriesMock.listSubscriptionsForReconcile.mockResolvedValue([
            {
                id: "sub_1",
                stripeCustomerId: "cus_1",
                status: "active",
                updatedAt: new Date(),
            },
            {
                id: "sub_2",
                stripeCustomerId: "cus_2",
                status: "trialing",
                updatedAt: new Date(),
            },
        ]);
        mirrorMock.mirrorSubscriptionById.mockResolvedValue(undefined);

        const result = await reconcileStaleSubscriptions();

        expect(result).toEqual({ inspected: 2, errors: 0 });
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenCalledTimes(2);
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenNthCalledWith(
            1,
            "sub_1",
        );
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenNthCalledWith(
            2,
            "sub_2",
        );
    });

    it("counts per-row errors without aborting the run", async () => {
        queriesMock.listSubscriptionsForReconcile.mockResolvedValue([
            {
                id: "sub_a",
                stripeCustomerId: "cus_a",
                status: "active",
                updatedAt: new Date(),
            },
            {
                id: "sub_b",
                stripeCustomerId: "cus_b",
                status: "active",
                updatedAt: new Date(),
            },
            {
                id: "sub_c",
                stripeCustomerId: "cus_c",
                status: "active",
                updatedAt: new Date(),
            },
        ]);
        mirrorMock.mirrorSubscriptionById
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Stripe 503"))
            .mockResolvedValueOnce(undefined);

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await reconcileStaleSubscriptions();
        errorSpy.mockRestore();

        expect(result).toEqual({ inspected: 3, errors: 1 });
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenCalledTimes(3);
    });
});
