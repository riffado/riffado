import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn(), execute: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    recordings: {
        userId: "user_id",
        deletedAt: "deleted_at",
        duration: "duration",
    },
    users: {
        id: "id",
    },
    foundingMemberReservations: {},
}));

import {
    getFoundingMemberOrdinal,
    getUserActivitySummary,
} from "@/db/queries/billing";

describe("getUserActivitySummary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns recording count and total duration for a user with activity", async () => {
        dbMock.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi
                    .fn()
                    .mockResolvedValue([
                        { recordingCount: 12, totalDurationMs: 43_200_000 },
                    ]),
            }),
        });

        await expect(getUserActivitySummary("u1")).resolves.toEqual({
            recordingCount: 12,
            totalDurationMs: 43_200_000,
        });
    });

    it("returns zeros for a user with no live recordings", async () => {
        dbMock.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
        });

        await expect(getUserActivitySummary("u1")).resolves.toEqual({
            recordingCount: 0,
            totalDurationMs: 0,
        });
    });
});

describe("getFoundingMemberOrdinal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the 1-indexed claim rank for a founding member", async () => {
        dbMock.execute.mockResolvedValueOnce([{ rank: 47 }]);

        await expect(getFoundingMemberOrdinal("u1")).resolves.toBe(47);
    });

    it("returns null for a user who never claimed founding pricing", async () => {
        dbMock.execute.mockResolvedValueOnce([]);

        await expect(getFoundingMemberOrdinal("u1")).resolves.toBeNull();
    });
});
