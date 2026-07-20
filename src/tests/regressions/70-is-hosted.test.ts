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

    it("parses annual and legacy Stripe Price env vars safely", () => {
        const parsed = envSchema.parse({
            STRIPE_PRICE_ID_USD: "price_usd",
            STRIPE_PRICE_ID_EUR: "price_eur",
            STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard",
            STRIPE_STANDARD_PRICE_ID_EUR: "price_eur_standard",
            STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
            STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year",
            STRIPE_LEGACY_PRO_PRICE_IDS:
                " price_old_usd,price_old_eur, ,price_old_extra ",
            BILLING_PRICE_USD_ANNUAL: "50.00",
            BILLING_PRICE_EUR_ANNUAL: "50.00",
        });
        expect(parsed.STRIPE_STANDARD_PRICE_ID_USD).toBe("price_usd_standard");
        expect(parsed.STRIPE_STANDARD_PRICE_ID_EUR).toBe("price_eur_standard");
        expect(parsed.STRIPE_PRICE_ID_USD_ANNUAL).toBe("price_usd_year");
        expect(parsed.STRIPE_PRICE_ID_EUR_ANNUAL).toBe("price_eur_year");
        expect(parsed.STRIPE_LEGACY_PRO_PRICE_IDS).toEqual([
            "price_old_usd",
            "price_old_eur",
            "price_old_extra",
        ]);
        expect(parsed.BILLING_PRICE_USD_ANNUAL).toBe("50.00");
        expect(parsed.BILLING_PRICE_EUR_ANNUAL).toBe("50.00");
        expect(envSchema.parse({}).STRIPE_LEGACY_PRO_PRICE_IDS).toEqual([]);
        expect(envSchema.parse({}).BILLING_FOUNDING_MEMBER_CAPACITY).toBe(100);
        expect(envSchema.parse({}).BILLING_STANDARD_PRICE_USD).toBe("9.00");
        expect(envSchema.parse({}).BILLING_STANDARD_PRICE_EUR).toBe("9.00");
        expect(() =>
            envSchema.parse({ BILLING_PRICE_USD_ANNUAL: "50" }),
        ).toThrow();
    });

    it("requires complete annual config for every supported monthly currency", () => {
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
            }),
        ).toThrow("Annual billing requires a display amount");
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_USD: "price_usd",
                BILLING_PRICE_USD_ANNUAL: "50.00",
            }),
        ).toThrow("Annual billing requires an annual Price");
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_PRICE_ID_EUR: "price_eur",
                STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
                BILLING_PRICE_USD_ANNUAL: "50.00",
            }),
        ).toThrow("EUR missing");
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year",
                BILLING_PRICE_EUR_ANNUAL: "50.00",
            }),
        ).toThrow("requires the monthly EUR Price");

        expect(
            envSchema.parse({
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
                BILLING_PRICE_USD_ANNUAL: "50.00",
            }),
        ).toMatchObject({
            STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
            BILLING_PRICE_USD_ANNUAL: "50.00",
        });
    });

    it("rejects current Stripe Price ids in legacy Price ids", () => {
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_LEGACY_PRO_PRICE_IDS: "price_old,price_usd",
            }),
        ).toThrow(
            "STRIPE_LEGACY_PRO_PRICE_IDS must not include current Stripe Price ids",
        );
        expect(() =>
            envSchema.parse({
                STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
                STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year",
                BILLING_PRICE_USD_ANNUAL: "50.00",
                BILLING_PRICE_EUR_ANNUAL: "50.00",
                STRIPE_LEGACY_PRO_PRICE_IDS: "price_usd_year",
            }),
        ).toThrow(
            "STRIPE_LEGACY_PRO_PRICE_IDS must not include current Stripe Price ids",
        );
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

    it("does not default MYNAH_BASE_URL", () => {
        expect(envSchema.parse({}).MYNAH_BASE_URL).toBeUndefined();
        expect(
            envSchema.parse({ MYNAH_BASE_URL: "https://mynah.example.com/" })
                .MYNAH_BASE_URL,
        ).toBe("https://mynah.example.com");
        expect(() =>
            envSchema.parse({ MYNAH_BASE_URL: "not-a-url" }),
        ).toThrow();
    });

    it("requires MYNAH_BASE_URL when billing is enabled", async () => {
        const originalEnv = { ...process.env };

        try {
            process.env = {
                ...originalEnv,
                APP_URL: "http://localhost:3000",
                BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
                BILLING_ENABLED: "true",
                DATABASE_URL:
                    "postgresql://user:password@localhost:5432/riffado",
                ENCRYPTION_KEY:
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                IS_HOSTED: "true",
                MYNAH_SERVICE_TOKEN: "secret",
                RATE_LIMIT_TRUST_PROXY_HEADERS: "true",
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_PRICE_ID_EUR: "price_eur",
                STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard",
                STRIPE_SECRET_KEY: "sk_test_123",
                STRIPE_WEBHOOK_SECRET: "whsec_123",
            } as NodeJS.ProcessEnv;
            delete process.env.MYNAH_BASE_URL;
            delete process.env.NEXT_PHASE;
            vi.resetModules();

            await expect(import("@/lib/env")).rejects.toThrow(
                "BILLING_ENABLED=true requires MYNAH_BASE_URL to be set",
            );

            process.env.MYNAH_BASE_URL = "https://mynah.example.com";
            vi.resetModules();

            await expect(import("@/lib/env")).resolves.toMatchObject({
                env: expect.objectContaining({
                    MYNAH_BASE_URL: "https://mynah.example.com",
                }),
            });
        } finally {
            process.env = originalEnv;
            vi.resetModules();
        }
    });

    it("refuses hosted billing on a self-host instance", async () => {
        const originalEnv = { ...process.env };

        try {
            process.env = {
                ...originalEnv,
                APP_URL: "http://localhost:3000",
                BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
                BILLING_ENABLED: "true",
                DATABASE_URL:
                    "postgresql://user:password@localhost:5432/riffado",
                ENCRYPTION_KEY:
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                IS_HOSTED: "false",
                MYNAH_BASE_URL: "https://mynah.example.com",
                MYNAH_SERVICE_TOKEN: "secret",
                STRIPE_PRICE_ID_USD: "price_usd",
                STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard",
                STRIPE_SECRET_KEY: "sk_test_123",
                STRIPE_WEBHOOK_SECRET: "whsec_123",
            } as NodeJS.ProcessEnv;
            delete process.env.NEXT_PHASE;
            vi.resetModules();

            await expect(import("@/lib/env")).rejects.toThrow(
                "BILLING_ENABLED=true requires IS_HOSTED=true",
            );
        } finally {
            process.env = originalEnv;
            vi.resetModules();
        }
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
