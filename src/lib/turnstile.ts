import { authEndpointPath } from "./auth-rate-limit";
import { env } from "./env";
import { ErrorCode } from "./errors";
import { captureServerException } from "./posthog-server";
import { getClientIp } from "./rate-limit";
import { CAPTCHA_RESPONSE_HEADER, TURNSTILE_ACTIONS } from "./turnstile-shared";

const SITEVERIFY_URL =
    "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 10_000;

/** Server-side Turnstile keys, present only when both are configured. */
export interface TurnstileConfig {
    siteKey: string;
    secretKey: string;
}

/**
 * Returns the Turnstile keys when the instance has both configured, else
 * null. Env validation rejects a half-configured pair at boot, so null
 * means "Turnstile disabled".
 */
export function getTurnstileConfig(): TurnstileConfig | null {
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return null;
    return {
        siteKey: env.TURNSTILE_SITE_KEY,
        secretKey: env.TURNSTILE_SECRET_KEY,
    };
}

/**
 * Public site key for the client widget, or null when Turnstile is
 * disabled. Passed to auth forms as a prop so the shared standalone
 * image reads it at runtime instead of baking it in at build time.
 */
export function getTurnstileSiteKey(): string | null {
    return getTurnstileConfig()?.siteKey ?? null;
}

interface SiteverifyResult {
    success?: unknown;
    "error-codes"?: unknown;
}

function rejection(
    status: number,
    code: ErrorCode,
    text: string,
    details?: Record<string, unknown>,
): Response {
    return Response.json(
        { error: text, message: text, code, ...(details && { details }) },
        { status },
    );
}

function unavailable(reason: unknown): Response {
    const errorId = `err_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    console.error(`[turnstile] [${errorId}] siteverify unavailable`, reason);
    captureServerException(reason, { source: "turnstile", errorId });
    return rejection(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        "The security check is temporarily unavailable. Please try again in a few minutes.",
        { errorId },
    );
}

/**
 * Verifies the Turnstile token on protected Better Auth endpoints. Returns
 * a rejection `Response` (400 missing token, 403 failed check, 503 when
 * Cloudflare cannot be reached), or null to let the request through. No-op
 * when Turnstile is not configured or the endpoint is not protected.
 */
export async function enforceTurnstile(
    request: Request,
): Promise<Response | null> {
    const config = getTurnstileConfig();
    if (!config) return null;

    const path = authEndpointPath(request);
    if (!Object.hasOwn(TURNSTILE_ACTIONS, path)) return null;

    const token = request.headers.get(CAPTCHA_RESPONSE_HEADER)?.trim();
    if (!token) {
        return rejection(
            400,
            ErrorCode.CAPTCHA_REQUIRED,
            "Complete the security check and try again.",
        );
    }

    const clientIp = getClientIp(request);
    let result: SiteverifyResult;
    try {
        const response = await fetch(SITEVERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                secret: config.secretKey,
                response: token,
                ...(clientIp !== "unknown" && { remoteip: clientIp }),
            }),
            signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
        });
        if (!response.ok) {
            return unavailable(
                new Error(`siteverify returned HTTP ${response.status}`),
            );
        }
        result = (await response.json()) as SiteverifyResult;
    } catch (error) {
        return unavailable(error);
    }

    if (result.success !== true) {
        const errorCodes = Array.isArray(result["error-codes"])
            ? result["error-codes"].filter((c) => typeof c === "string")
            : [];
        if (
            errorCodes.includes("invalid-input-secret") ||
            errorCodes.includes("missing-input-secret")
        ) {
            return unavailable(
                new Error(`siteverify rejected the secret: ${errorCodes}`),
            );
        }
        return rejection(
            403,
            ErrorCode.CAPTCHA_FAILED,
            "The security check failed. Please try again.",
        );
    }

    return null;
}
