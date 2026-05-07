/**
 * Regression test for PR #90:
 *   "feat(analytics): add Rybbit analytics for hosted mode"
 *
 * Verifies the env-schema contract for the Rybbit hosted-only vars:
 *   - RYBBIT_SITE_ID is an optional string (no shape validation).
 *   - RYBBIT_HOST is an optional URL; non-URL strings must be rejected.
 *   - Partial config (only one of the two set) parses fine at the schema
 *     level. The runtime gate in src/components/rybbit-analytics.tsx and
 *     next.config.ts requires BOTH to be set before activating analytics,
 *     so a half-configured hosted deploy stays disabled rather than
 *     half-broken.
 *
 * NEXT_PHASE is set so importing env.ts does not run the runtime
 * validation (DATABASE_URL etc) - we only need the schema here.
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

describe("PR #90: Rybbit env contract", () => {
    it("defaults both vars to undefined when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.RYBBIT_SITE_ID).toBeUndefined();
        expect(parsed.RYBBIT_HOST).toBeUndefined();
    });

    it("accepts a valid RYBBIT_HOST URL", () => {
        const parsed = envSchema.parse({
            RYBBIT_HOST: "https://rybbit.example.com",
        });
        expect(parsed.RYBBIT_HOST).toBe("https://rybbit.example.com");
    });

    it("rejects a non-URL RYBBIT_HOST", () => {
        expect(() =>
            envSchema.parse({ RYBBIT_HOST: "not-a-url" }),
        ).toThrowError(/RYBBIT_HOST must be a valid URL/);
    });

    it("rejects empty-string RYBBIT_HOST", () => {
        expect(() => envSchema.parse({ RYBBIT_HOST: "" })).toThrowError(
            /RYBBIT_HOST must be a valid URL/,
        );
    });

    it("accepts only RYBBIT_SITE_ID without RYBBIT_HOST (partial config)", () => {
        // The schema allows partial config; runtime gates in the analytics
        // component + next.config.ts enforce that BOTH must be set before
        // analytics activates. This stays disabled, not half-broken.
        const parsed = envSchema.parse({ RYBBIT_SITE_ID: "abc123" });
        expect(parsed.RYBBIT_SITE_ID).toBe("abc123");
        expect(parsed.RYBBIT_HOST).toBeUndefined();
    });

    it("accepts only RYBBIT_HOST without RYBBIT_SITE_ID (partial config)", () => {
        const parsed = envSchema.parse({
            RYBBIT_HOST: "https://rybbit.example.com",
        });
        expect(parsed.RYBBIT_HOST).toBe("https://rybbit.example.com");
        expect(parsed.RYBBIT_SITE_ID).toBeUndefined();
    });

    it("accepts both vars set together", () => {
        const parsed = envSchema.parse({
            RYBBIT_SITE_ID: "abc123",
            RYBBIT_HOST: "https://rybbit.example.com",
        });
        expect(parsed.RYBBIT_SITE_ID).toBe("abc123");
        expect(parsed.RYBBIT_HOST).toBe("https://rybbit.example.com");
    });
});
