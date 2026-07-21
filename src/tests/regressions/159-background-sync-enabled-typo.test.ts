/**
 * Regression test for a review comment on PR #253 (issue #159):
 *   "Invalid Opt-Out Values Enable Sync"
 *
 * BACKGROUND_SYNC_ENABLED originally used `val !== "false"`, so any typo
 * (e.g. "flase") silently resolved to `true` -- an operator trying to opt
 * out of background sync would get it enabled anyway. The schema now
 * rejects anything other than "true"/"false"/unset.
 *
 * NEXT_PHASE is set so importing env.ts does not run the runtime
 * validation (DATABASE_URL etc) -- we only need the schema here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type EnvSchema = typeof import("@/lib/env")["envSchema"];
let envSchema: EnvSchema;
let originalNextPhase: string | undefined;

beforeAll(async () => {
    originalNextPhase = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    ({ envSchema } = await import("@/lib/env"));
});

afterAll(() => {
    if (originalNextPhase === undefined) {
        delete process.env.NEXT_PHASE;
    } else {
        process.env.NEXT_PHASE = originalNextPhase;
    }
});

describe("issue #159: BACKGROUND_SYNC_ENABLED env contract", () => {
    it("defaults to true when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.BACKGROUND_SYNC_ENABLED).toBe(true);
    });

    it("defaults to true when set to an empty string", () => {
        const parsed = envSchema.parse({ BACKGROUND_SYNC_ENABLED: "" });
        expect(parsed.BACKGROUND_SYNC_ENABLED).toBe(true);
    });

    it('resolves "true" to true', () => {
        const parsed = envSchema.parse({ BACKGROUND_SYNC_ENABLED: "true" });
        expect(parsed.BACKGROUND_SYNC_ENABLED).toBe(true);
    });

    it('resolves "false" to false', () => {
        const parsed = envSchema.parse({ BACKGROUND_SYNC_ENABLED: "false" });
        expect(parsed.BACKGROUND_SYNC_ENABLED).toBe(false);
    });

    it('rejects a typo like "flase" instead of silently enabling sync', () => {
        expect(() =>
            envSchema.parse({ BACKGROUND_SYNC_ENABLED: "flase" }),
        ).toThrowError(/BACKGROUND_SYNC_ENABLED must be either/);
    });

    it("rejects arbitrary non-boolean strings", () => {
        expect(() =>
            envSchema.parse({ BACKGROUND_SYNC_ENABLED: "no" }),
        ).toThrowError(/BACKGROUND_SYNC_ENABLED must be either/);
    });
});
