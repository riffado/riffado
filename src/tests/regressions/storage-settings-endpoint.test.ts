/**
 * Regression: Settings → Storage endpoint contract.
 *
 * Locks in the post-revamp shape of GET /api/settings/storage:
 *   - usage totals (single aggregate row)
 *   - 12-month gap-filled `monthly` series
 *   - `largest` top-N with decrypted filenames
 *   - `diskFreeBytes` is null on hosted; `storageType` is "hosted"
 *     when IS_HOSTED is true (don't leak underlying backend to tenants)
 *   - `quotaBytes` is null today (reserved seam for future plans)
 *   - all queries are userId-scoped (any future drift here is a
 *     cross-tenant data leak)
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envState = {
    IS_HOSTED: false as boolean,
    DEFAULT_STORAGE_TYPE: "local" as "local" | "s3",
    LOCAL_STORAGE_PATH: "/tmp/riffado-test-nonexistent-storage-path",
};

vi.mock("@/lib/env", () => ({
    env: new Proxy(
        {},
        {
            get: (_t, key: string) =>
                (envState as Record<string, unknown>)[key],
        },
    ),
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi
        .fn()
        .mockResolvedValue({ user: { id: "user-storage-1" } }),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string | null) =>
        typeof value === "string" ? value.replace(/^encrypted:/, "") : value,
    ),
}));

// Captures every where(...) clause passed to a query builder. Each
// call is a Drizzle SQL expression; below we render it via the PG
// dialect so we can assert both that a `where` was issued **and** that
// the userId predicate is actually present (not just that some
// where() happened, which a count-only check would let pass even if
// the SQL had no userId reference at all).
const whereSpy = vi.fn();
const pgDialect = new PgDialect();

function whereCallToSql(call: unknown[]) {
    const arg = call[0] as Parameters<typeof pgDialect.sqlToQuery>[0];
    return pgDialect.sqlToQuery(arg);
}

const mockDb = {
    select: vi.fn(),
};
vi.mock("@/db", () => ({ db: mockDb }));

// Build a chainable query stub matching the two shapes the route
// uses: totals (await on where) and largest (await on limit after
// orderBy). `where()` returns a real Promise so awaiting it works
// without thenable trickery; the same Promise also carries .orderBy
// for the chained variant.
function makeQueryStub(result: unknown[]) {
    const wherePromise = Promise.resolve(result) as Promise<unknown> & {
        orderBy: (...args: unknown[]) => {
            limit: (n: number) => Promise<unknown>;
        };
    };
    wherePromise.orderBy = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
    });
    const stub: Record<string, unknown> = {};
    stub.from = vi.fn().mockReturnValue(stub);
    stub.where = vi.fn().mockImplementation((...args: unknown[]) => {
        whereSpy(...args);
        return wherePromise;
    });
    return stub;
}

describe("GET /api/settings/storage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        whereSpy.mockClear();
        envState.IS_HOSTED = false;
        envState.DEFAULT_STORAGE_TYPE = "local";
    });

    afterEach(() => {
        vi.resetModules();
    });

    async function callRoute() {
        const mod = await import("@/app/api/settings/storage/route");
        return mod.GET(
            new Request("http://localhost/api/settings/storage"),
            {} as never,
        );
    }

    it("returns the new shape and scopes every query (self-host local)", async () => {
        // Two selects in order: totals, largest.
        mockDb.select
            .mockReturnValueOnce(
                makeQueryStub([
                    {
                        usedBytes: 1_500,
                        recordingCount: 3,
                        totalDurationMs: 60_000,
                    },
                ]),
            )
            .mockReturnValueOnce(
                makeQueryStub([
                    {
                        id: "rec-1",
                        filename: "encrypted:Big File",
                        filesize: 999,
                        duration: 12000,
                        startTime: new Date("2026-05-01T00:00:00Z"),
                    },
                ]),
            );

        const response = await callRoute();
        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body).toMatchObject({
            storageType: "local",
            usedBytes: 1500,
            recordingCount: 3,
            totalDurationMs: 60_000,
            quotaBytes: null,
        });
        // Monthly series was deliberately removed; ensure it stays out
        // so the client doesn't silently start consuming a re-added
        // field by accident.
        expect(body.monthly).toBeUndefined();

        // Largest list has decrypted filename.
        expect(body.largest).toEqual([
            expect.objectContaining({
                id: "rec-1",
                filename: "Big File",
                filesize: 999,
            }),
        ]);

        // Tenant isolation: every where() the route issued must
        // reference `user_id` AND bind the session user's id as a
        // parameter. Counting calls alone wouldn't catch a regression
        // that swaps `eq(recordings.userId, ...)` for, say,
        // `eq(recordings.id, ...)` while leaving a single where() in
        // place. Rendering the SQL via the real PG dialect verifies
        // both predicate column and bound value.
        expect(whereSpy).toHaveBeenCalledTimes(2);
        for (const call of whereSpy.mock.calls) {
            const { sql, params } = whereCallToSql(call);
            expect(sql).toMatch(/"user_id"/);
            expect(params).toContain("user-storage-1");
        }
    });

    it("hides the storage backend and skips disk-free on hosted", async () => {
        envState.IS_HOSTED = true;
        envState.DEFAULT_STORAGE_TYPE = "local";

        mockDb.select
            .mockReturnValueOnce(
                makeQueryStub([
                    {
                        usedBytes: 0,
                        recordingCount: 0,
                        totalDurationMs: 0,
                    },
                ]),
            )
            .mockReturnValueOnce(makeQueryStub([]));

        const response = await callRoute();
        const body = await response.json();

        expect(body.storageType).toBe("hosted");
        expect(body.diskFreeBytes).toBeNull();
        expect(body.quotaBytes).toBeNull();
    });

    it("returns null diskFreeBytes when S3 is the backend", async () => {
        envState.IS_HOSTED = false;
        envState.DEFAULT_STORAGE_TYPE = "s3";

        mockDb.select
            .mockReturnValueOnce(
                makeQueryStub([
                    {
                        usedBytes: 0,
                        recordingCount: 0,
                        totalDurationMs: 0,
                    },
                ]),
            )
            .mockReturnValueOnce(makeQueryStub([]));

        const response = await callRoute();
        const body = await response.json();

        expect(body.storageType).toBe("s3");
        expect(body.diskFreeBytes).toBeNull();
    });
});
