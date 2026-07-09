/**
 * Unit tests for the install-script hit counter (`src/lib/admin/install-hits.ts`).
 *
 * Pins:
 *   - Self-host (`IS_HOSTED=false`) is a hard no-op: the counter never
 *     touches the DB and the stats query returns zeros without reading.
 *   - On hosted, valid version tags pass through and bogus ones get
 *     bucketed as "invalid" so route abuse can't blow up table cardinality.
 *   - Counter swallows DB errors (the install script must serve even
 *     when the DB is unhealthy).
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

const mockEnv = vi.hoisted(() => ({
    IS_HOSTED: false,
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

const mockDb = vi.hoisted(() => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const orderBy = vi.fn(
        async () => [] as Array<{ version: string; count: number }>,
    );
    const groupBy = vi.fn(() => ({ orderBy }));
    const where = vi.fn(() => ({ groupBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    return { insert, select, values, onConflictDoUpdate, orderBy };
});

vi.mock("@/db", () => ({
    db: {
        insert: mockDb.insert,
        select: mockDb.select,
    },
}));

import {
    getInstallHitStats,
    recordInstallHit,
} from "@/lib/hosted/admin/install-hits";

beforeEach(() => {
    mockEnv.IS_HOSTED = false;
    (mockDb.insert as Mock).mockClear();
    (mockDb.select as Mock).mockClear();
    (mockDb.values as Mock).mockClear();
    (mockDb.onConflictDoUpdate as Mock).mockClear();
    (mockDb.orderBy as Mock).mockClear();
    (mockDb.orderBy as Mock).mockImplementation(async () => []);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("recordInstallHit", () => {
    it("is a no-op on self-host (IS_HOSTED=false)", async () => {
        mockEnv.IS_HOSTED = false;
        await recordInstallHit("latest");
        await recordInstallHit("v0.5.3");
        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("upserts on hosted for the 'latest' bucket", async () => {
        mockEnv.IS_HOSTED = true;
        await recordInstallHit("latest");
        expect(mockDb.insert).toHaveBeenCalledTimes(1);
        const inserted = (mockDb.values as Mock).mock.calls[0]?.[0];
        expect(inserted).toMatchObject({ version: "latest", count: 1 });
        expect(inserted.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("preserves valid vX.Y.Z tags verbatim", async () => {
        mockEnv.IS_HOSTED = true;
        await recordInstallHit("v0.5.3");
        const inserted = (mockDb.values as Mock).mock.calls[0]?.[0];
        expect(inserted.version).toBe("v0.5.3");
    });

    it("buckets malformed version segments as 'invalid'", async () => {
        mockEnv.IS_HOSTED = true;
        await recordInstallHit("../../etc/passwd");
        await recordInstallHit("0.5.3"); // missing leading v
        await recordInstallHit("v0.5.3-rc.1"); // not strict X.Y.Z
        const versions = (mockDb.values as Mock).mock.calls.map(
            (c) => (c[0] as { version: string }).version,
        );
        expect(versions).toEqual(["invalid", "invalid", "invalid"]);
    });

    it("swallows DB errors so the install script keeps serving", async () => {
        mockEnv.IS_HOSTED = true;
        (mockDb.onConflictDoUpdate as Mock).mockRejectedValueOnce(
            new Error("db down"),
        );
        await expect(recordInstallHit("latest")).resolves.toBeUndefined();
    });
});

describe("getInstallHitStats", () => {
    it("returns zeros on self-host without reading the DB", async () => {
        mockEnv.IS_HOSTED = false;
        const stats = await getInstallHitStats(30);
        expect(stats).toEqual({
            total: 0,
            distinctVersions: 0,
            topVersions: [],
        });
        expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("aggregates totals, distinct version count, and top-N on hosted", async () => {
        mockEnv.IS_HOSTED = true;
        (mockDb.orderBy as Mock).mockImplementationOnce(async () => [
            { version: "latest", count: 120 },
            { version: "v0.5.3", count: 40 },
            { version: "v0.5.2", count: 12 },
            { version: "invalid", count: 3 },
        ]);
        const stats = await getInstallHitStats(30, 2);
        expect(stats.total).toBe(175);
        expect(stats.distinctVersions).toBe(4);
        expect(stats.topVersions).toEqual([
            { version: "latest", count: 120 },
            { version: "v0.5.3", count: 40 },
        ]);
    });
});
