/**
 * Regression coverage for issue #85: better-auth's email/password endpoints
 * were entirely un-throttled. `enforceAuthRateLimit` wraps the
 * `/api/auth/[...all]` POST handler and enforces per-IP (and, for the
 * SMTP-triggering `/forget-password` path, per-email) limits using the
 * project's DB-backed bucket store.
 *
 * Pinned behaviours:
 *   1. Unknown auth paths pass through untouched (return null).
 *   2. A known path under its IP limit passes through.
 *   3. An exceeded IP limit returns 429 with a Retry-After header.
 *   4. `/forget-password` applies a per-email bucket so a single victim
 *      can't be targeted from rotating IPs, and reading the email does NOT
 *      consume the request body (better-auth must still parse it).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RateLimitResult } from "@/lib/rate-limit";

const consumeRateLimitBucket = vi.hoisted(() => vi.fn());
const clientIp = vi.hoisted(() => ({ value: "198.51.100.1" }));

vi.mock("@/lib/rate-limit", () => ({
    consumeRateLimitBucket,
    getClientIp: () => clientIp.value,
}));

import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";

function allowed(): RateLimitResult {
    return {
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: new Date(Date.now() + 60_000),
    };
}

function blocked(): RateLimitResult {
    return {
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: new Date(Date.now() + 60_000),
    };
}

function authRequest(path: string, body?: unknown): Request {
    return new Request(`https://example.com/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("enforceAuthRateLimit", () => {
    beforeEach(() => {
        (consumeRateLimitBucket as Mock).mockReset();
        clientIp.value = "198.51.100.1";
    });

    it("passes through unknown auth paths without touching the limiter", async () => {
        const result = await enforceAuthRateLimit(authRequest("/get-session"));
        expect(result).toBeNull();
        expect(consumeRateLimitBucket).not.toHaveBeenCalled();
    });

    it("allows a sign-in under the IP limit", async () => {
        (consumeRateLimitBucket as Mock).mockResolvedValue(allowed());
        const result = await enforceAuthRateLimit(
            authRequest("/sign-in/email", {
                email: "a@b.com",
                password: "x",
            }),
        );
        expect(result).toBeNull();
        expect(consumeRateLimitBucket).toHaveBeenCalledWith(
            "auth:ip:/sign-in/email:198.51.100.1",
            expect.objectContaining({ limit: 10 }),
        );
    });

    it("returns 429 with Retry-After when the IP limit is exceeded", async () => {
        (consumeRateLimitBucket as Mock).mockResolvedValue(blocked());
        const result = await enforceAuthRateLimit(
            authRequest("/sign-in/email", {
                email: "a@b.com",
                password: "x",
            }),
        );
        expect(result).not.toBeNull();
        expect(result?.status).toBe(429);
        const retryAfter = result?.headers.get("Retry-After");
        expect(retryAfter).toBeTruthy();
        expect(Number(retryAfter)).toBeGreaterThan(0);
        // Body follows the app envelope (`error` + `code`) and keeps `message`
        // for better-auth's better-fetch -> result.error.message in the forms.
        const body = (await result?.json()) as Record<string, unknown>;
        expect(body.code).toBe("RATE_LIMITED");
        expect(typeof body.error).toBe("string");
        expect(body.message).toBe(body.error);
    });

    it("skips the per-IP bucket when the client IP is unknown (no cross-user lockout)", async () => {
        // Proxy-header trust off: every client resolves to "unknown". A shared
        // low-limit IP bucket would let one actor lock everyone out, so the IP
        // dimension fails open. forget-password still gets its per-email cap.
        clientIp.value = "unknown";
        (consumeRateLimitBucket as Mock).mockResolvedValue(allowed());

        const signIn = await enforceAuthRateLimit(
            authRequest("/sign-in/email", { email: "a@b.com", password: "x" }),
        );
        expect(signIn).toBeNull();
        expect(consumeRateLimitBucket).not.toHaveBeenCalled();

        const forget = await enforceAuthRateLimit(
            authRequest("/forget-password", { email: "a@b.com" }),
        );
        expect(forget).toBeNull();
        // only the email bucket runs, never an `auth:ip:...:unknown` bucket
        expect(consumeRateLimitBucket).toHaveBeenCalledTimes(1);
        expect(consumeRateLimitBucket).toHaveBeenCalledWith(
            "auth:email:/forget-password:a@b.com",
            expect.objectContaining({ limit: 3 }),
        );
    });

    it("applies a per-email bucket on forget-password without consuming the body", async () => {
        (consumeRateLimitBucket as Mock)
            .mockResolvedValueOnce(allowed()) // IP bucket
            .mockResolvedValueOnce(blocked()); // email bucket

        const request = authRequest("/forget-password", {
            email: "Victim@Example.com",
        });
        const result = await enforceAuthRateLimit(request);

        expect(result?.status).toBe(429);
        // email is lowercased into the bucket key
        expect(consumeRateLimitBucket).toHaveBeenLastCalledWith(
            "auth:email:/forget-password:victim@example.com",
            expect.objectContaining({ limit: 3 }),
        );
        // body must still be readable by better-auth downstream
        await expect(request.json()).resolves.toEqual({
            email: "Victim@Example.com",
        });
    });
});
