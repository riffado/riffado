import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, stripeMock, mirrorMock } = vi.hoisted(() => ({
    queriesMock: {
        expireFoundingMemberReservationByCheckoutSession: vi.fn(),
        listFoundingReservationsForExpiryCheck: vi.fn(),
    },
    stripeMock: {
        checkout: { sessions: { retrieve: vi.fn() } },
    },
    mirrorMock: { mirrorCheckoutSession: vi.fn() },
}));

vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => ({
    getStripe: () => stripeMock,
}));
vi.mock("@/lib/hosted/billing/mirror", () => mirrorMock);

import { reconcileExpiredFoundingReservations } from "@/lib/hosted/billing/founding-reservations";

describe("reconcileExpiredFoundingReservations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("releases Stripe-expired founding reservations", async () => {
        const now = new Date("2026-07-01T01:00:00.000Z");
        queriesMock.listFoundingReservationsForExpiryCheck.mockResolvedValue([
            {
                id: "fmr_1",
                stripeCheckoutSessionId: "cs_expired",
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            },
        ]);
        stripeMock.checkout.sessions.retrieve.mockResolvedValue({
            id: "cs_expired",
            status: "expired",
        });

        await expect(
            reconcileExpiredFoundingReservations({ now, limit: 10 }),
        ).resolves.toEqual({
            inspected: 1,
            expired: 1,
            completed: 0,
            errors: 0,
        });

        expect(
            queriesMock.expireFoundingMemberReservationByCheckoutSession,
        ).toHaveBeenCalledWith("cs_expired", now);
    });

    it("mirrors completed sessions instead of releasing their reservation", async () => {
        const now = new Date("2026-07-01T01:00:00.000Z");
        const session = {
            id: "cs_complete",
            status: "complete",
            subscription: "sub_1",
        };
        queriesMock.listFoundingReservationsForExpiryCheck.mockResolvedValue([
            {
                id: "fmr_2",
                stripeCheckoutSessionId: "cs_complete",
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            },
        ]);
        stripeMock.checkout.sessions.retrieve.mockResolvedValue(session);

        await expect(
            reconcileExpiredFoundingReservations({ now }),
        ).resolves.toEqual({
            inspected: 1,
            expired: 0,
            completed: 1,
            errors: 0,
        });

        expect(mirrorMock.mirrorCheckoutSession).toHaveBeenCalledWith(session);
        expect(
            queriesMock.expireFoundingMemberReservationByCheckoutSession,
        ).not.toHaveBeenCalled();
    });
});
