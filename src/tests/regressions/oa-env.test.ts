/**
 * Env-schema contract for the Open Analytics hosted-only vars:
 *   - OA_TRACKING_KEY is an optional string (no shape validation).
 *   - OA_HOST is an optional URL; non-URL strings must be rejected.
 *   - Partial config (only one of the two set) parses fine at the schema
 *     level. The runtime gate in src/components/open-analytics.tsx
 *     requires BOTH plus IS_HOSTED before injecting the snippet, so a
 *     half-configured hosted deploy stays disabled rather than
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

describe("Open Analytics env contract", () => {
    it("defaults both vars to undefined when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.OA_TRACKING_KEY).toBeUndefined();
        expect(parsed.OA_HOST).toBeUndefined();
    });

    it("accepts a valid OA_HOST URL", () => {
        const parsed = envSchema.parse({
            OA_HOST: "https://oa.example.com",
        });
        expect(parsed.OA_HOST).toBe("https://oa.example.com");
    });

    it("rejects a non-URL OA_HOST", () => {
        expect(() => envSchema.parse({ OA_HOST: "not-a-url" })).toThrowError(
            /OA_HOST must be a valid URL/,
        );
    });

    it("rejects empty-string OA_HOST", () => {
        expect(() => envSchema.parse({ OA_HOST: "" })).toThrowError(
            /OA_HOST must be a valid URL/,
        );
    });

    it("accepts only OA_TRACKING_KEY without OA_HOST (partial config)", () => {
        const parsed = envSchema.parse({ OA_TRACKING_KEY: "site_abc123" });
        expect(parsed.OA_TRACKING_KEY).toBe("site_abc123");
        expect(parsed.OA_HOST).toBeUndefined();
    });

    it("accepts both vars set together", () => {
        const parsed = envSchema.parse({
            OA_TRACKING_KEY: "site_abc123",
            OA_HOST: "https://oa.example.com",
        });
        expect(parsed.OA_TRACKING_KEY).toBe("site_abc123");
        expect(parsed.OA_HOST).toBe("https://oa.example.com");
    });

    it("does not accept RYBBIT_* leftovers", () => {
        const parsed = envSchema.parse({
            RYBBIT_SITE_ID: "abc123",
            RYBBIT_HOST: "https://rybbit.example.com",
            OA_TRACKING_KEY: "site_abc123",
            OA_HOST: "https://oa.example.com",
        });
        expect(parsed.OA_TRACKING_KEY).toBe("site_abc123");
        expect(parsed.OA_HOST).toBe("https://oa.example.com");
        expect(
            (parsed as Record<string, unknown>).RYBBIT_SITE_ID,
        ).toBeUndefined();
        expect((parsed as Record<string, unknown>).RYBBIT_HOST).toBeUndefined();
    });
});
