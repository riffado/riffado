import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long-1234567890",
        ADMIN_REAUTH_TTL_MINUTES: 30,
        ADMIN_MUTATION_TTL_MINUTES: 10,
    },
}));

import {
    isWithinMutationTtl,
    isWithinReauthTtl,
    signElevatedCookie,
    verifyElevatedCookie,
} from "@/lib/hosted/admin/elevated-cookie";

describe("elevated cookie", () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it("signs and verifies", () => {
        const cookie = signElevatedCookie("user_abc", 1_700_000_000_000);
        const p = verifyElevatedCookie(cookie);
        expect(p).not.toBeNull();
        expect(p?.userId).toBe("user_abc");
        expect(p?.issuedAt).toBe(1_700_000_000_000);
    });

    it("rejects null and malformed inputs", () => {
        expect(verifyElevatedCookie(null)).toBeNull();
        expect(verifyElevatedCookie("")).toBeNull();
        expect(verifyElevatedCookie("only.two")).toBeNull();
        expect(verifyElevatedCookie("a.b.c.d")).toBeNull();
    });

    it("rejects tampered MAC", () => {
        const cookie = signElevatedCookie("user_abc", 1_700_000_000_000);
        const parts = cookie.split(".");
        // flip a hex char
        const tamperedMac =
            parts[2][0] === "0"
                ? `1${parts[2].slice(1)}`
                : `0${parts[2].slice(1)}`;
        const tampered = `${parts[0]}.${parts[1]}.${tamperedMac}`;
        expect(verifyElevatedCookie(tampered)).toBeNull();
    });

    it("rejects tampered userId (MAC mismatch)", () => {
        const cookie = signElevatedCookie("user_abc", 1_700_000_000_000);
        const parts = cookie.split(".");
        const tampered = `user_xyz.${parts[1]}.${parts[2]}`;
        expect(verifyElevatedCookie(tampered)).toBeNull();
    });

    it("reauth TTL: in-window passes, out-of-window fails", () => {
        const issuedAt = Date.now();
        const cookie = signElevatedCookie("u", issuedAt);
        const p = verifyElevatedCookie(cookie);
        if (!p) throw new Error("cookie should verify");
        expect(isWithinReauthTtl(p, issuedAt + 1000)).toBe(true);
        expect(isWithinReauthTtl(p, issuedAt + 31 * 60 * 1000)).toBe(false);
    });

    it("mutation TTL is tighter than reauth TTL", () => {
        const issuedAt = Date.now();
        const cookie = signElevatedCookie("u", issuedAt);
        const p = verifyElevatedCookie(cookie);
        if (!p) throw new Error("cookie should verify");
        // 15 minutes -> mutation expired, reauth still valid
        const t = issuedAt + 15 * 60 * 1000;
        expect(isWithinMutationTtl(p, t)).toBe(false);
        expect(isWithinReauthTtl(p, t)).toBe(true);
    });
});
