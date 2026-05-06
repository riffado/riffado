import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

import {
    createPersonalAccessToken,
    getPersonalAccessTokenPrefix,
    hashPersonalAccessToken,
    isPersonalAccessTokenActive,
    normalizeTokenScopes,
} from "@/lib/auth-request";

describe("API tokens", () => {
    it("generates opp-prefixed tokens and display prefixes", () => {
        const token = createPersonalAccessToken();

        expect(token).toMatch(/^opp_[A-Za-z0-9_-]{24}$/);
        expect(getPersonalAccessTokenPrefix(token)).toBe(token.slice(0, 12));
    });

    it("hashes tokens deterministically without storing the raw token", () => {
        const token = "opp_testtoken";
        const hash = hashPersonalAccessToken(token);

        expect(hash).toHaveLength(64);
        expect(hash).toBe(hashPersonalAccessToken(token));
        expect(hash).not.toContain(token);
    });

    it("treats revoked and expired tokens as inactive", () => {
        const now = new Date("2026-05-06T12:00:00.000Z");

        expect(
            isPersonalAccessTokenActive(
                { revokedAt: null, expiresAt: null },
                now,
            ),
        ).toBe(true);
        expect(
            isPersonalAccessTokenActive(
                {
                    revokedAt: new Date("2026-05-06T11:00:00.000Z"),
                    expiresAt: null,
                },
                now,
            ),
        ).toBe(false);
        expect(
            isPersonalAccessTokenActive(
                {
                    revokedAt: null,
                    expiresAt: new Date("2026-05-06T11:00:00.000Z"),
                },
                now,
            ),
        ).toBe(false);
    });

    it("normalizes scopes to read-only", () => {
        expect(normalizeTokenScopes(["read", "write", 1])).toEqual(["read"]);
        expect(normalizeTokenScopes([])).toEqual(["read"]);
        expect(normalizeTokenScopes("read")).toEqual(["read"]);
    });
});
