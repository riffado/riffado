import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
    API_TOKEN_HASH_SECRET: undefined as string | undefined,
    RATE_LIMIT_TRUST_PROXY_HEADERS: undefined as boolean | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
    },
}));

import { getClientIp } from "@/lib/v1/rate-limit";

describe("v1 rate limiting", () => {
    beforeEach(() => {
        mockEnv.BETTER_AUTH_SECRET = "better-auth-secret-with-32-chars";
        mockEnv.API_TOKEN_HASH_SECRET = undefined;
        mockEnv.RATE_LIMIT_TRUST_PROXY_HEADERS = undefined;
    });

    it("ignores spoofable forwarding headers unless proxy trust is enabled", () => {
        const request = new Request("http://localhost/api/v1/recordings", {
            headers: {
                "x-forwarded-for": "203.0.113.10",
                "x-real-ip": "203.0.113.11",
                "cf-connecting-ip": "203.0.113.12",
            },
        });

        expect(getClientIp(request)).toBe("unknown");
    });

    it("uses trusted proxy headers when explicitly enabled", () => {
        mockEnv.RATE_LIMIT_TRUST_PROXY_HEADERS = true;

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: { "cf-connecting-ip": "203.0.113.12" },
                }),
            ),
        ).toBe("203.0.113.12");

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: { "x-real-ip": "203.0.113.11" },
                }),
            ),
        ).toBe("203.0.113.11");

        expect(
            getClientIp(
                new Request("http://localhost/api/v1/recordings", {
                    headers: {
                        "x-forwarded-for":
                            "198.51.100.1, 198.51.100.2, 203.0.113.10",
                    },
                }),
            ),
        ).toBe("198.51.100.1");
    });
});
