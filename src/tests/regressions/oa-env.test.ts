/**
 * Env-schema contract for the Open Analytics hosted-only var:
 *   - OA_TRACKING_KEY is an optional string (no shape validation).
 *   - Unset parses as undefined. The runtime gate in
 *     src/components/open-analytics.tsx requires IS_HOSTED + this key
 *     before injecting the snippet, so a self-host deploy or a hosted
 *     deploy without the key stays disabled.
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
    it("defaults OA_TRACKING_KEY to undefined when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.OA_TRACKING_KEY).toBeUndefined();
    });

    it("accepts a tracking key", () => {
        const parsed = envSchema.parse({ OA_TRACKING_KEY: "site_abc123" });
        expect(parsed.OA_TRACKING_KEY).toBe("site_abc123");
    });

    it("does not accept RYBBIT_* leftovers", () => {
        const parsed = envSchema.parse({
            RYBBIT_SITE_ID: "abc123",
            RYBBIT_HOST: "https://rybbit.example.com",
            OA_TRACKING_KEY: "site_abc123",
        });
        expect(parsed.OA_TRACKING_KEY).toBe("site_abc123");
        expect(
            (parsed as Record<string, unknown>).RYBBIT_SITE_ID,
        ).toBeUndefined();
        expect((parsed as Record<string, unknown>).RYBBIT_HOST).toBeUndefined();
    });
});
