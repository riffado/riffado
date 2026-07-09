import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long-1234567890",
        APP_URL: "https://riffado.com",
    },
}));

import {
    signUnsubscribeToken,
    verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe-token";

describe("unsubscribe token", () => {
    it("round-trips: sign then verify for the same audience+id", () => {
        const userToken = signUnsubscribeToken("user", "u_abc123");
        expect(verifyUnsubscribeToken("user", "u_abc123", userToken)).toBe(
            true,
        );

        const subToken = signUnsubscribeToken("subscriber", "s_xyz789");
        expect(verifyUnsubscribeToken("subscriber", "s_xyz789", subToken)).toBe(
            true,
        );
    });

    it("does not cross audiences (user token doesn't verify as subscriber)", () => {
        const userToken = signUnsubscribeToken("user", "abc");
        expect(verifyUnsubscribeToken("subscriber", "abc", userToken)).toBe(
            false,
        );
    });

    it("does not cross ids", () => {
        const token = signUnsubscribeToken("user", "user-a");
        expect(verifyUnsubscribeToken("user", "user-b", token)).toBe(false);
    });

    it("rejects tampered tokens", () => {
        const token = signUnsubscribeToken("user", "abc");
        // Flip the middle byte. Base64url last-char padding can have
        // multiple representations for the same underlying bytes, so
        // tampering the tail is unreliable -- the middle is not.
        const mid = Math.floor(token.length / 2);
        const c = token.charAt(mid);
        const replacement = c === "A" ? "B" : "A";
        const tampered = `${token.slice(0, mid)}${replacement}${token.slice(mid + 1)}`;
        expect(tampered).not.toBe(token);
        expect(verifyUnsubscribeToken("user", "abc", tampered)).toBe(false);
    });

    it("rejects empty / non-string token", () => {
        expect(verifyUnsubscribeToken("user", "abc", "")).toBe(false);
        // Ensure no unhandled throw on weird input.
        expect(
            verifyUnsubscribeToken("user", "abc", "not-base64-padding!!"),
        ).toBe(false);
    });

    it("produces a stable token for the same input", () => {
        const t1 = signUnsubscribeToken("user", "abc");
        const t2 = signUnsubscribeToken("user", "abc");
        expect(t1).toBe(t2);
    });
});
