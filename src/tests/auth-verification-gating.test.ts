import { describe, expect, it, vi } from "vitest";

/**
 * Verifies the behavior contract added in bite 5: email verification
 * is opt-in via SMTP presence. Self-host without SMTP keeps the
 * historical "no verification required" path so operators don't get
 * locked out without a delivery channel.
 *
 * We assert the contract by checking the SMTP-detection helper rather
 * than reaching into Better Auth internals -- the auth config is a
 * pure function of `isSmtpConfigured()`, so testing the gate captures
 * the relevant behavior without binding the test to Better Auth's
 * runtime options shape.
 */

const { envMock } = vi.hoisted(() => ({
    envMock: {
        SMTP_HOST: undefined as string | undefined,
        SMTP_USER: undefined as string | undefined,
        SMTP_PASSWORD: undefined as string | undefined,
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { isSmtpConfigured } from "@/lib/smtp";

describe("email-verification gating via SMTP presence", () => {
    it("returns false on a self-host instance without SMTP (verification stays opt-out)", () => {
        envMock.SMTP_HOST = undefined;
        envMock.SMTP_USER = undefined;
        envMock.SMTP_PASSWORD = undefined;
        expect(isSmtpConfigured()).toBe(false);
    });

    it("returns true once all three SMTP fields are configured (verification turns on)", () => {
        envMock.SMTP_HOST = "smtp.example.com";
        envMock.SMTP_USER = "u";
        envMock.SMTP_PASSWORD = "p";
        expect(isSmtpConfigured()).toBe(true);
    });

    it.each([
        ["host only", "smtp.example.com", undefined, undefined],
        ["user only", undefined, "u", undefined],
        ["password only", undefined, undefined, "p"],
        ["host + user, no password", "smtp.example.com", "u", undefined],
    ])("partial SMTP config does not enable verification (%s)", (_label, host, user, password) => {
        envMock.SMTP_HOST = host;
        envMock.SMTP_USER = user;
        envMock.SMTP_PASSWORD = password;
        expect(isSmtpConfigured()).toBe(false);
    });
});
