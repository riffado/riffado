/**
 * SMTP_REPLY_TO: lets the From: address stay a no-reply/branded sender
 * while replies land in a monitored inbox (e.g. support@riffado.com).
 * Distinct from SMTP_FROM/SMTP_MARKETING_FROM.
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

describe("SMTP_REPLY_TO schema", () => {
    it("is undefined by default", () => {
        expect(envSchema.parse({}).SMTP_REPLY_TO).toBeUndefined();
    });

    it("accepts a bare email address", () => {
        expect(
            envSchema.parse({ SMTP_REPLY_TO: "support@riffado.com" })
                .SMTP_REPLY_TO,
        ).toBe("support@riffado.com");
    });

    it("accepts a 'Name <email>' formatted address", () => {
        expect(
            envSchema.parse({
                SMTP_REPLY_TO: "Riffado Support <support@riffado.com>",
            }).SMTP_REPLY_TO,
        ).toBe("Riffado Support <support@riffado.com>");
    });

    it("rejects a malformed value", () => {
        expect(() =>
            envSchema.parse({ SMTP_REPLY_TO: "not-an-email" }),
        ).toThrow();
    });
});

describe("resolveReplyToAddress", () => {
    afterAll(() => {
        vi.doUnmock("@/lib/env");
        vi.resetModules();
    });

    it("returns SMTP_REPLY_TO when set", async () => {
        vi.resetModules();
        vi.doMock("@/lib/env", () => ({
            env: { SMTP_REPLY_TO: "support@riffado.com" },
        }));
        vi.doMock("@/lib/smtp", () => ({ isSmtpConfigured: () => true }));

        const { resolveReplyToAddress } = await import("@/lib/email/transport");
        expect(resolveReplyToAddress()).toBe("support@riffado.com");
    });

    it("returns undefined when unset (no Reply-To header added)", async () => {
        vi.resetModules();
        vi.doMock("@/lib/env", () => ({ env: {} }));
        vi.doMock("@/lib/smtp", () => ({ isSmtpConfigured: () => true }));

        const { resolveReplyToAddress } = await import("@/lib/email/transport");
        expect(resolveReplyToAddress()).toBeUndefined();
    });
});
