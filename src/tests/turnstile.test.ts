/**
 * Turnstile on Better Auth endpoints:
 *   - env contract: both keys or neither; blank counts as unset.
 *   - `enforceTurnstile` is a no-op when disabled or on unprotected paths.
 *   - Protected paths reject a missing token (400) and a rejected token
 *     (403), and fail closed with 503 when Cloudflare is unreachable or
 *     rejects the server's secret.
 *   - The visitor IP is forwarded as `remoteip` only when the trusted
 *     proxy-derived IP is known.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, clientIp, captureServerException } = vi.hoisted(() => {
    process.env.NEXT_PHASE = "phase-production-build";
    return {
        envMock: {
            TURNSTILE_SITE_KEY: undefined as string | undefined,
            TURNSTILE_SECRET_KEY: undefined as string | undefined,
        },
        clientIp: { value: "198.51.100.7" },
        captureServerException: vi.fn(),
    };
});

vi.mock("@/lib/env", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, env: envMock };
});

vi.mock("@/lib/rate-limit", () => ({
    consumeRateLimitBucket: vi.fn(),
    getClientIp: () => clientIp.value,
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerException,
    captureServerEvent: vi.fn(),
}));

import { envSchema } from "@/lib/env";
import {
    enforceTurnstile,
    getTurnstileConfig,
    getTurnstileSiteKey,
} from "@/lib/turnstile";

function enable() {
    envMock.TURNSTILE_SITE_KEY = "site";
    envMock.TURNSTILE_SECRET_KEY = "secret";
}

function authRequest(path: string, token?: string): Request {
    return new Request(`https://riffado.test/api/auth${path}`, {
        method: "POST",
        headers: token ? { "x-captcha-response": token } : {},
    });
}

function stubSiteverify(body: unknown, status = 200) {
    const fetchMock = vi.fn(
        async (_url: string, _init: RequestInit) =>
            new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

async function rejectionBody(res: Response | null) {
    if (!res) throw new Error("expected a rejection response");
    return res.json();
}

function sentBody(fetchMock: ReturnType<typeof stubSiteverify>) {
    const init = fetchMock.mock.calls[0]?.[1];
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
    clientIp.value = "198.51.100.7";
    captureServerException.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    envMock.TURNSTILE_SITE_KEY = undefined;
    envMock.TURNSTILE_SECRET_KEY = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Turnstile env contract", () => {
    it("treats unset and blank keys as disabled", () => {
        const parsed = envSchema.parse({
            TURNSTILE_SITE_KEY: "",
            TURNSTILE_SECRET_KEY: "  ",
        });
        expect(parsed.TURNSTILE_SITE_KEY).toBeUndefined();
        expect(parsed.TURNSTILE_SECRET_KEY).toBeUndefined();
    });

    it("accepts both keys together", () => {
        const parsed = envSchema.parse({
            TURNSTILE_SITE_KEY: "0x4AAA",
            TURNSTILE_SECRET_KEY: "0x4BBB",
        });
        expect(parsed.TURNSTILE_SITE_KEY).toBe("0x4AAA");
        expect(parsed.TURNSTILE_SECRET_KEY).toBe("0x4BBB");
    });

    it.each([
        ["site key only", { TURNSTILE_SITE_KEY: "0x4AAA" }],
        ["secret key only", { TURNSTILE_SECRET_KEY: "0x4BBB" }],
    ])("rejects a half-configured pair (%s)", (_label, input) => {
        expect(() => envSchema.parse(input)).toThrowError(
            /must be set together/,
        );
    });
});

describe("getTurnstileConfig", () => {
    it("returns null when Turnstile is not configured", () => {
        expect(getTurnstileConfig()).toBeNull();
        expect(getTurnstileSiteKey()).toBeNull();
    });

    it("returns both keys when configured", () => {
        enable();
        expect(getTurnstileConfig()).toEqual({
            siteKey: "site",
            secretKey: "secret",
        });
        expect(getTurnstileSiteKey()).toBe("site");
    });
});

describe("enforceTurnstile", () => {
    it("is a no-op when Turnstile is disabled", async () => {
        const fetchMock = stubSiteverify({ success: false });
        expect(
            await enforceTurnstile(authRequest("/sign-up/email")),
        ).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        "/get-session",
        "/sign-out",
        "/reset-password",
        "/sign-up/emailx",
    ])("does not gate %s", async (path) => {
        enable();
        const fetchMock = stubSiteverify({ success: false });
        expect(await enforceTurnstile(authRequest(path))).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        "/sign-up/email",
        "/sign-in/email",
        "/request-password-reset",
        "/send-verification-email",
        "//sign-up//email",
    ])("rejects %s without a token", async (path) => {
        enable();
        const res = await enforceTurnstile(authRequest(path));
        expect(res?.status).toBe(400);
        const body = await rejectionBody(res);
        expect(body.code).toBe("CAPTCHA_REQUIRED");
        expect(body.message).toBe(body.error);
    });

    it("rejects a token Cloudflare reports as invalid", async () => {
        enable();
        stubSiteverify({
            success: false,
            "error-codes": ["invalid-input-response"],
        });
        const res = await enforceTurnstile(
            authRequest("/sign-in/email", "bad"),
        );
        expect(res?.status).toBe(403);
        expect((await rejectionBody(res)).code).toBe("CAPTCHA_FAILED");
    });

    it("lets a valid token through and forwards the client IP", async () => {
        enable();
        const fetchMock = stubSiteverify({ success: true });
        const res = await enforceTurnstile(
            authRequest("/sign-up/email", "good"),
        );
        expect(res).toBeNull();
        expect(sentBody(fetchMock)).toEqual({
            secret: "secret",
            response: "good",
            remoteip: "198.51.100.7",
        });
    });

    it("omits remoteip when the client IP is unknown", async () => {
        enable();
        clientIp.value = "unknown";
        const fetchMock = stubSiteverify({ success: true });
        await enforceTurnstile(authRequest("/sign-up/email", "good"));
        expect(sentBody(fetchMock)).not.toHaveProperty("remoteip");
    });

    it("fails closed with 503 when siteverify is unreachable", async () => {
        enable();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        const res = await enforceTurnstile(authRequest("/sign-up/email", "t"));
        expect(res?.status).toBe(503);
        const body = await rejectionBody(res);
        expect(body.code).toBe("SERVICE_UNAVAILABLE");
        expect(body.details.errorId).toMatch(/^err_[0-9a-f]{8}$/);
        expect(captureServerException).toHaveBeenCalledOnce();
    });

    it("fails closed with 503 when siteverify returns a non-2xx status", async () => {
        enable();
        stubSiteverify({}, 502);
        const res = await enforceTurnstile(authRequest("/sign-up/email", "t"));
        expect(res?.status).toBe(503);
    });

    it("treats a rejected secret key as an operator error, not a user failure", async () => {
        enable();
        stubSiteverify({
            success: false,
            "error-codes": ["invalid-input-secret"],
        });
        const res = await enforceTurnstile(authRequest("/sign-in/email", "t"));
        expect(res?.status).toBe(503);
        expect(captureServerException).toHaveBeenCalledOnce();
    });
});
