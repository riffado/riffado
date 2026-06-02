/**
 * Regression coverage for the rate-limit bucket upsert. Two distinct
 * failure modes are pinned here:
 *
 *   1. `upsertRateLimitBucket` must never hand a `Date` instance to the
 *      postgres-js driver via a raw `sql\`\`` template literal. Drizzle
 *      only runs its column encoders for `.values({...})` and bare
 *      column-mapped values in `.set({...})`; values interpolated into
 *      `sql\`case when ... <= ${now}\`` bypass the encoder and reach the
 *      driver as raw JS objects. postgres-js then crashes with
 *      `ERR_INVALID_ARG_TYPE` (TypeError: "The 'string' argument must
 *      be of type string or an instance of Buffer or ArrayBuffer.
 *      Received an instance of Date") and every v1 API request +
 *      Plaud sync starts returning 500. The fix encodes Date params
 *      as ISO strings with explicit `::timestamp` casts; this test
 *      walks the SQL fragments and fails if any `Date` instance is
 *      still embedded in them.
 *
 *   2. `consumeRateLimitBucket` must fail OPEN when the bucket store is
 *      unreachable. A broken rate limiter taking down the API is worse
 *      than a brief enforcement gap, especially since upstream
 *      (Cloudflare / ALB) still rate-limits at the edge and the v1
 *      surface has per-token auth as a second gate.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
    API_TOKEN_HASH_SECRET: undefined as string | undefined,
    RATE_LIMIT_TRUST_PROXY_HEADERS: undefined as boolean | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
    },
}));

import { db } from "@/db";
import { consumeRateLimitBucket } from "@/lib/rate-limit";

interface CapturedConflictConfig {
    set: Record<string, unknown>;
}

function captureOnConflictArgs(): {
    captured: { last?: CapturedConflictConfig };
} {
    const captured: { last?: CapturedConflictConfig } = {};
    (db.insert as unknown as Mock).mockReturnValue({
        values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn((cfg: CapturedConflictConfig) => {
                captured.last = cfg;
                return {
                    returning: vi.fn().mockResolvedValue([
                        {
                            count: 1,
                            resetAt: new Date("2025-01-01T00:01:00.000Z"),
                        },
                    ]),
                };
            }),
        }),
    });
    return { captured };
}

/**
 * Deep-walks an object graph and returns the dotted paths at which any
 * `Date` instance is found. Used to assert no Date leaks into a raw
 * `sql\`\`` template's chunk tree.
 *
 * Tracks visited objects with a WeakSet so cyclic graphs (Drizzle's
 * internal SQL nodes do reference each other) don't loop forever.
 */
function findDatePaths(
    value: unknown,
    path: string,
    seen: WeakSet<object>,
): string[] {
    if (value instanceof Date) return [path || "<root>"];
    if (value === null || typeof value !== "object") return [];
    if (seen.has(value as object)) return [];
    seen.add(value as object);
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out.push(...findDatePaths(v, path ? `${path}.${k}` : k, seen));
    }
    return out;
}

describe("rate-limit bucket upsert", () => {
    beforeEach(() => {
        mockEnv.BETTER_AUTH_SECRET = "better-auth-secret-with-32-chars";
        mockEnv.API_TOKEN_HASH_SECRET = undefined;
        (db.insert as unknown as Mock).mockReset();
    });

    it("never embeds a Date instance in the raw-sql update fragments", async () => {
        const { captured } = captureOnConflictArgs();

        await consumeRateLimitBucket("ip:198.51.100.1", {
            limit: 60,
            windowMs: 60_000,
            now: new Date("2025-01-01T00:00:00.000Z"),
        });

        expect(captured.last).toBeDefined();
        if (!captured.last) return;

        // `set.count` and `set.resetAt` are SQL fragments built via the
        // `sql\`\`` tag. Walk both fragment trees -- any Date inside is
        // exactly the bug that crashed postgres-js in production.
        const countFragment = captured.last.set.count;
        const resetAtFragment = captured.last.set.resetAt;

        expect(
            findDatePaths(countFragment, "set.count", new WeakSet()),
        ).toEqual([]);
        expect(
            findDatePaths(resetAtFragment, "set.resetAt", new WeakSet()),
        ).toEqual([]);

        // Sanity: `set.updatedAt` is a column-bound assignment, not a
        // raw sql template, so it IS allowed (and expected) to be a
        // Date -- Drizzle's column encoder will serialise it. If this
        // ever stops being a Date the column encoding has regressed.
        expect(captured.last.set.updatedAt).toBeInstanceOf(Date);
    });

    it("fails open with a synthetic full bucket when the store throws", async () => {
        (db.insert as unknown as Mock).mockImplementation(() => {
            throw new Error("simulated DB outage");
        });

        // Silence the expected console.warn so test output stays clean.
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await consumeRateLimitBucket("user:abc", {
            limit: 60,
            windowMs: 60_000,
            now: new Date("2025-01-01T00:00:00.000Z"),
        });

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(60);
        expect(result.remaining).toBe(60);
        expect(result.resetAt).toBeInstanceOf(Date);
        expect(warnSpy).toHaveBeenCalledWith(
            "[rate-limit] bucket store unavailable; failing open",
            "simulated DB outage",
        );

        warnSpy.mockRestore();
    });
});
