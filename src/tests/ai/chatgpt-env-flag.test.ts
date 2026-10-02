/**
 * ENABLE_CHATGPT_PLAN_USAGE uses the strict boolean contract (see #159):
 * an operator typo must fail startup instead of silently leaving the
 * opt-in off.
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

describe("ENABLE_CHATGPT_PLAN_USAGE env contract", () => {
    it("is unset (off) when missing or empty", () => {
        expect(envSchema.parse({}).ENABLE_CHATGPT_PLAN_USAGE).toBeUndefined();
        expect(
            envSchema.parse({ ENABLE_CHATGPT_PLAN_USAGE: "" })
                .ENABLE_CHATGPT_PLAN_USAGE,
        ).toBeUndefined();
    });

    it('accepts "true" and "false"', () => {
        expect(
            envSchema.parse({ ENABLE_CHATGPT_PLAN_USAGE: "true" })
                .ENABLE_CHATGPT_PLAN_USAGE,
        ).toBe(true);
        expect(
            envSchema.parse({ ENABLE_CHATGPT_PLAN_USAGE: "false" })
                .ENABLE_CHATGPT_PLAN_USAGE,
        ).toBe(false);
    });

    it.each([
        "TRUE",
        "1",
        "yes",
        "on",
    ])("rejects %s instead of silently staying off", (value) => {
        const result = envSchema.safeParse({
            ENABLE_CHATGPT_PLAN_USAGE: value,
        });
        expect(result.success).toBe(false);
        const issue = result.error?.issues.find(
            (i) => i.path[0] === "ENABLE_CHATGPT_PLAN_USAGE",
        );
        expect(issue?.message).toMatch(/must be either/);
    });
});
