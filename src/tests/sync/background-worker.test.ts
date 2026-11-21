import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, envMock, syncMock } = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
    },
    envMock: {
        IS_HOSTED: true,
        BACKGROUND_SYNC_ENABLED: true,
        BACKGROUND_SYNC_INTERVAL_MS: 5 * 60 * 1000,
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
        invalidatedAt: "invalidated_at",
    },
    users: {
        id: "id",
        plan: "plan",
        suspendedAt: "suspended_at",
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/sync/sync-recordings", () => syncMock);

import {
    drainPending,
    resetStatusRecorderForTests,
    setStatusRecordingEnabled,
} from "@/lib/status/record";
import { claimUsersForSync, tick } from "@/lib/sync/worker";

function stubClaimQuery(rows: { userId: string }[]) {
    const where = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
        }),
    });
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({ where }),
        }),
    });
    return where;
}

describe("claimUsersForSync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
    });

    it("returns user IDs from the query", async () => {
        stubClaimQuery([{ userId: "u1" }, { userId: "u2" }]);
        const result = await claimUsersForSync();
        expect(result).toEqual(["u1", "u2"]);
    });

    it("returns empty array when no eligible users need sync", async () => {
        stubClaimQuery([]);
        const result = await claimUsersForSync();
        expect(result).toEqual([]);
    });

    it("filters on hosted_pro when IS_HOSTED is true", async () => {
        envMock.IS_HOSTED = true;
        const where = stubClaimQuery([]);
        await claimUsersForSync();
        // 3 conditions: suspendedAt, lastSync staleness, plan === hosted_pro
        expect(where).toHaveBeenCalledTimes(1);
    });

    it("does not filter on plan when IS_HOSTED is false (self-host)", async () => {
        envMock.IS_HOSTED = false;
        stubClaimQuery([{ userId: "self-host-user" }]);
        const result = await claimUsersForSync();
        expect(result).toEqual(["self-host-user"]);
    });
});

describe("sync status job", () => {
    const clean = {
        newRecordings: 0,
        updatedRecordings: 0,
        errors: [] as string[],
        pendingTranscriptionIds: [] as string[],
    };

    function syncRun() {
        return drainPending().jobs.find((job) => job.job === "sync") ?? null;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        setStatusRecordingEnabled(false);
        vi.restoreAllMocks();
    });

    it("records a failure, not a success, when a sync returns operational errors", async () => {
        stubClaimQuery([{ userId: "u1" }]);
        syncMock.syncRecordingsForUser.mockResolvedValue({
            ...clean,
            errors: ["Sync failed: connect ECONNREFUSED"],
        });
        await tick();
        expect(syncRun()).toMatchObject({
            lastSuccessAt: null,
            lastErrorAt: expect.any(Date),
        });
    });

    it("records a success for a sync without errors", async () => {
        stubClaimQuery([{ userId: "u1" }]);
        syncMock.syncRecordingsForUser.mockResolvedValue(clean);
        await tick();
        expect(syncRun()).toMatchObject({
            lastSuccessAt: expect.any(Date),
            lastErrorAt: null,
        });
    });

    it("ignores a user whose Plaud token was rejected", async () => {
        stubClaimQuery([{ userId: "dead" }, { userId: "broken" }]);
        syncMock.syncRecordingsForUser
            .mockResolvedValueOnce({
                ...clean,
                errors: ["Plaud rejected the stored token."],
                needsReconnect: true,
            })
            .mockResolvedValueOnce({
                ...clean,
                errors: ["Sync failed: boom"],
            });
        await tick();
        expect(syncRun()).toMatchObject({
            lastSuccessAt: null,
            lastErrorAt: expect.any(Date),
        });
    });

    it("counts a pass where every user was skipped for a user-caused reason as a completed run", async () => {
        stubClaimQuery([{ userId: "dead" }, { userId: "locked" }]);
        syncMock.syncRecordingsForUser
            .mockResolvedValueOnce({
                ...clean,
                errors: ["Plaud rejected the stored token."],
                needsReconnect: true,
            })
            .mockResolvedValueOnce({
                ...clean,
                errors: ["Your hosted plan has lapsed."],
                skipped: "locked_out",
            });
        await tick();
        expect(syncRun()).toMatchObject({
            lastSuccessAt: expect.any(Date),
            lastErrorAt: null,
        });
    });

    it("records a failure when a sync throws", async () => {
        stubClaimQuery([{ userId: "u1" }]);
        vi.spyOn(console, "error").mockImplementation(() => {});
        syncMock.syncRecordingsForUser.mockRejectedValue(new Error("boom"));
        await tick();
        expect(syncRun()).toMatchObject({
            lastSuccessAt: null,
            lastErrorAt: expect.any(Date),
        });
    });
});

describe("startBackgroundSyncWorker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        envMock.IS_HOSTED = false;
        envMock.BACKGROUND_SYNC_ENABLED = true;
        envMock.BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
        stubClaimQuery([]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("schedules a tick when BACKGROUND_SYNC_ENABLED is true (default)", async () => {
        vi.resetModules();
        const { startBackgroundSyncWorker } = await import("@/lib/sync/worker");
        startBackgroundSyncWorker();
        expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it("does not schedule anything when BACKGROUND_SYNC_ENABLED is false", async () => {
        envMock.BACKGROUND_SYNC_ENABLED = false;
        vi.resetModules();
        const { startBackgroundSyncWorker } = await import("@/lib/sync/worker");
        startBackgroundSyncWorker();
        expect(vi.getTimerCount()).toBe(0);
    });
});
