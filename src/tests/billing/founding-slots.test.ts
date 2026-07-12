import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, txMock } = vi.hoisted(() => {
    const tx = {
        execute: vi.fn(),
        insert: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
    };
    return {
        txMock: tx,
        dbMock: {
            execute: vi.fn(),
            transaction: vi.fn(
                async (callback: (txArg: typeof tx) => unknown) => callback(tx),
            ),
            update: vi.fn(),
        },
    };
});

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    foundingMemberReservations: {
        id: "id",
        userId: "user_id",
        stripeCheckoutSessionId: "stripe_checkout_session_id",
        stripePriceId: "stripe_price_id",
        status: "status",
        expiresAt: "expires_at",
        releasedAt: "released_at",
        updatedAt: "updated_at",
        consumedAt: "consumed_at",
    },
    users: {
        id: "id",
        foundingMember: "founding_member",
        foundingMemberClaimedAt: "founding_member_claimed_at",
        updatedAt: "updated_at",
    },
}));

import {
    consumeFoundingMemberReservation,
    createFoundingMemberReservation,
    getFoundingMemberAvailability,
} from "@/db/queries/billing";

function chainSelect(rows: unknown[]) {
    txMock.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
            }),
        }),
    });
}

function chainUpdate(rows: unknown[]) {
    txMock.update.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue(rows),
            }),
        }),
    });
}

describe("founding monthly slot reservations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        txMock.execute.mockReset();
        txMock.insert.mockReset();
        txMock.select.mockReset();
        txMock.update.mockReset();
        dbMock.execute.mockReset();
        dbMock.transaction.mockReset();
        dbMock.update.mockReset();
        txMock.update.mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        dbMock.transaction.mockImplementation(
            async (callback: (txArg: typeof txMock) => unknown) =>
                callback(txMock),
        );
        dbMock.update.mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    it("reports real availability from claimed and reserved slots", async () => {
        dbMock.execute.mockResolvedValueOnce([{ claimed: 37, reserved: 2 }]);

        await expect(getFoundingMemberAvailability(100)).resolves.toEqual({
            capacity: 100,
            claimed: 37,
            reserved: 2,
            remaining: 61,
        });
    });

    it("does not reserve the 101st checkout", async () => {
        txMock.execute
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ claimed: 100, reserved: 0 }]);
        chainSelect([{ foundingMemberClaimedAt: null }]);
        chainSelect([]);

        await expect(
            createFoundingMemberReservation({
                userId: "u101",
                capacity: 100,
                stripePriceId: "price_found",
                now: new Date("2026-07-01T00:00:00Z"),
                expiresAt: new Date("2026-07-01T00:35:00Z"),
            }),
        ).resolves.toBeNull();

        expect(txMock.insert).not.toHaveBeenCalled();
    });

    it("consumes a matching reservation exactly once after payment", async () => {
        txMock.execute.mockResolvedValueOnce([]);
        chainSelect([
            {
                id: "fmr_1",
                userId: "u1",
                stripePriceId: "price_found",
                status: "reserved",
                expiresAt: new Date("2026-07-01T00:35:00Z"),
            },
        ]);
        chainUpdate([{ id: "u1" }]);
        txMock.update.mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });

        await expect(
            consumeFoundingMemberReservation({
                reservationId: "fmr_1",
                userId: "u1",
                stripePriceId: "price_found",
                paidAt: new Date("2026-07-01T00:05:00Z"),
            }),
        ).resolves.toBe(true);

        expect(txMock.update).toHaveBeenCalledTimes(2);
    });

    it.each([
        "expired",
        "released",
    ] as const)("refuses to consume a %s reservation", async (status) => {
        txMock.execute.mockResolvedValueOnce([]);
        chainSelect([
            {
                id: "fmr_1",
                userId: "u1",
                stripePriceId: "price_found",
                status,
                expiresAt: new Date("2026-07-01T00:35:00Z"),
            },
        ]);

        await expect(
            consumeFoundingMemberReservation({
                reservationId: "fmr_1",
                userId: "u1",
                stripePriceId: "price_found",
                paidAt: new Date("2026-07-01T00:05:00Z"),
            }),
        ).resolves.toBe(false);

        expect(txMock.update).not.toHaveBeenCalled();
    });

    it("refuses to consume a reservation for another user", async () => {
        txMock.execute.mockResolvedValueOnce([]);
        chainSelect([
            {
                id: "fmr_1",
                userId: "u1",
                stripePriceId: "price_found",
                status: "reserved",
                expiresAt: new Date("2026-07-01T00:35:00Z"),
            },
        ]);

        await expect(
            consumeFoundingMemberReservation({
                reservationId: "fmr_1",
                userId: "u2",
                stripePriceId: "price_found",
                paidAt: new Date("2026-07-01T00:05:00Z"),
            }),
        ).resolves.toBe(false);

        expect(txMock.update).not.toHaveBeenCalled();
    });
});
