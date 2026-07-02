import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, envMock, syncMock } = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
    },
    envMock: {
        IS_HOSTED: true,
    },
    syncMock: {
        syncRecordingsForUser: vi.fn(),
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    plaudConnections: {
        userId: "user_id",
        lastSync: "last_sync",
    },
    users: {
        id: "id",
        plan: "plan",
        suspendedAt: "suspended_at",
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/sync/sync-recordings", () => syncMock);

import { claimProUsersForSync } from "@/lib/hosted/sync/worker";

function stubClaimQuery(rows: { userId: string }[]) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(rows),
                }),
            }),
        }),
    });
}

describe("claimProUsersForSync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns user IDs from the query", async () => {
        stubClaimQuery([{ userId: "u1" }, { userId: "u2" }]);
        const result = await claimProUsersForSync();
        expect(result).toEqual(["u1", "u2"]);
    });

    it("returns empty array when no Pro users need sync", async () => {
        stubClaimQuery([]);
        const result = await claimProUsersForSync();
        expect(result).toEqual([]);
    });
});
