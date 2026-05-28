/**
 * Regression test for issue #70:
 *   "Add IS_HOSTED flag to gate marketing surfaces on self-host"
 *
 * Default behavior is self-host (IS_HOSTED=false): the marketing landing
 * page at `/` should not be served, and logged-out visitors are redirected
 * to /login. Only the Riffado-operated hosted instance sets IS_HOSTED=true
 * to render Hero / Pricing / FinalCTA / etc.
 *
 * This test verifies the env-schema contract: IS_HOSTED parses string-boolean
 * correctly with a `false` default. The page-level redirect in src/app/page.tsx
 * branches directly on `env.IS_HOSTED`; if this contract holds, the redirect
 * does too.
 *
 * NEXT_PHASE is set so importing env.ts does not run the runtime validation
 * (DATABASE_URL etc) -- we only need the schema here. Restored in afterAll
 * so other tests sharing the worker aren't affected.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

describe("issue #70: IS_HOSTED env contract", () => {
    it("defaults to false when unset", () => {
        const parsed = envSchema.parse({});
        expect(parsed.IS_HOSTED).toBe(false);
    });

    it("defaults to false for any string other than 'true'", () => {
        for (const v of ["false", "0", "1", "yes", "no", "TRUE", "True", ""]) {
            const parsed = envSchema.parse({ IS_HOSTED: v });
            expect(parsed.IS_HOSTED, `value=${JSON.stringify(v)}`).toBe(false);
        }
    });

    it("is true only for the literal string 'true'", () => {
        const parsed = envSchema.parse({ IS_HOSTED: "true" });
        expect(parsed.IS_HOSTED).toBe(true);
    });

    it("preserves unset WEBHOOKS_REQUIRE_PUBLIC_TARGETS", () => {
        const parsed = envSchema.parse({});
        expect(parsed.WEBHOOKS_REQUIRE_PUBLIC_TARGETS).toBeUndefined();
    });

    it("parses WEBHOOKS_REQUIRE_PUBLIC_TARGETS as a strict optional boolean", () => {
        expect(
            envSchema.parse({ WEBHOOKS_REQUIRE_PUBLIC_TARGETS: "true" })
                .WEBHOOKS_REQUIRE_PUBLIC_TARGETS,
        ).toBe(true);
        expect(
            envSchema.parse({ WEBHOOKS_REQUIRE_PUBLIC_TARGETS: "false" })
                .WEBHOOKS_REQUIRE_PUBLIC_TARGETS,
        ).toBe(false);

        expect(
            envSchema.parse({ WEBHOOKS_REQUIRE_PUBLIC_TARGETS: "" })
                .WEBHOOKS_REQUIRE_PUBLIC_TARGETS,
        ).toBeUndefined();

        for (const v of ["0", "1", "yes", "TRUE", "False"]) {
            expect(() =>
                envSchema.parse({ WEBHOOKS_REQUIRE_PUBLIC_TARGETS: v }),
            ).toThrow();
        }
    });

    it("parses RATE_LIMIT_TRUST_PROXY_HEADERS as a strict optional boolean", () => {
        expect(
            envSchema.parse({ RATE_LIMIT_TRUST_PROXY_HEADERS: "true" })
                .RATE_LIMIT_TRUST_PROXY_HEADERS,
        ).toBe(true);
        expect(
            envSchema.parse({ RATE_LIMIT_TRUST_PROXY_HEADERS: "false" })
                .RATE_LIMIT_TRUST_PROXY_HEADERS,
        ).toBe(false);
        expect(
            envSchema.parse({ RATE_LIMIT_TRUST_PROXY_HEADERS: "" })
                .RATE_LIMIT_TRUST_PROXY_HEADERS,
        ).toBeUndefined();

        for (const v of ["0", "1", "yes", "TRUE", "False"]) {
            expect(() =>
                envSchema.parse({ RATE_LIMIT_TRUST_PROXY_HEADERS: v }),
            ).toThrow();
        }
    });

    it("requires API_TOKEN_HASH_SECRET to be strong when set", () => {
        expect(envSchema.parse({}).API_TOKEN_HASH_SECRET).toBeUndefined();
        expect(
            envSchema.parse({ API_TOKEN_HASH_SECRET: "" })
                .API_TOKEN_HASH_SECRET,
        ).toBeUndefined();
        expect(() =>
            envSchema.parse({ API_TOKEN_HASH_SECRET: "short" }),
        ).toThrow();
        expect(
            envSchema.parse({
                API_TOKEN_HASH_SECRET: "token-hash-secret-with-32-characters",
            }).API_TOKEN_HASH_SECRET,
        ).toBe("token-hash-secret-with-32-characters");
    });

    it("requires trusted proxy IP headers when hosted mode serves runtime requests", async () => {
        const originalEnv = { ...process.env };
        const runtimeEnv = {
            APP_URL: "http://localhost:3000",
            BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
            DATABASE_URL: "postgresql://user:password@localhost:5432/riffado",
            ENCRYPTION_KEY:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            IS_HOSTED: "true",
            NEXT_PHASE: undefined,
        };

        try {
            process.env = {
                ...originalEnv,
                ...runtimeEnv,
            } as NodeJS.ProcessEnv;
            delete process.env.NEXT_PHASE;
            delete process.env.RATE_LIMIT_TRUST_PROXY_HEADERS;
            vi.resetModules();

            await expect(import("@/lib/env")).rejects.toThrow(
                "RATE_LIMIT_TRUST_PROXY_HEADERS=true must be set when IS_HOSTED=true",
            );

            process.env.RATE_LIMIT_TRUST_PROXY_HEADERS = "true";
            vi.resetModules();

            await expect(import("@/lib/env")).resolves.toMatchObject({
                env: expect.objectContaining({
                    IS_HOSTED: true,
                    RATE_LIMIT_TRUST_PROXY_HEADERS: true,
                }),
            });
        } finally {
            process.env = originalEnv;
            vi.resetModules();
        }
    });
});
