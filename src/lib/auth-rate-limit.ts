import { ErrorCode } from "@/lib/errors";
import {
    consumeRateLimitBucket,
    getClientIp,
    type RateLimitResult,
} from "@/lib/rate-limit";

/**
 * Rate limiting for better-auth's email/password endpoints.
 *
 * better-auth ships its own limiter, but it defaults to an in-memory store
 * that is per-process -- useless under the hosted multi-process deployment
 * (see AGENTS.md hosted invariants). Instead we reuse the project's
 * DB-backed bucket store (`consumeRateLimitBucket`), the same primitive the
 * `/api/v1` surface and plaud sync use. One rate-limit mechanism, multi-
 * process safe by default, fail-open on bucket-store outage.
 *
 * Threat model:
 * - `/forget-password` triggers outbound SMTP. An attacker hammering it
 *   with one victim's address burns sender quota and bounce-spams the
 *   victim, hurting the instance's mail reputation. Needs a per-EMAIL cap,
 *   not just per-IP, because a distributed attacker rotates IPs.
 * - `/sign-in/email` is credential-stuffing surface (per-IP).
 * - `/sign-up/email` is spam-account surface (per-IP).
 * - `/reset-password` consumes a reset token (per-IP).
 */

const WINDOW_MS = 60_000;

interface AuthRateRule {
    /** Max requests per client IP per window. */
    ipLimit: number;
    /**
     * Optional max requests per target email per window. Set on paths that
     * trigger outbound email so a single victim can't be targeted from many
     * IPs. The email is read from the JSON request body.
     */
    emailLimit?: number;
}

/** Keyed by the better-auth endpoint path (the part after `/api/auth`). */
const RULES: Record<string, AuthRateRule> = {
    "/sign-in/email": { ipLimit: 10 },
    "/sign-up/email": { ipLimit: 5 },
    "/forget-password": { ipLimit: 5, emailLimit: 3 },
    "/reset-password": { ipLimit: 5 },
};

function authPath(request: Request): string {
    const { pathname } = new URL(request.url);
    const marker = "/api/auth";
    const index = pathname.indexOf(marker);
    return index === -1 ? pathname : pathname.slice(index + marker.length);
}

async function readEmail(request: Request): Promise<string | null> {
    // Clone so better-auth still gets an unconsumed body downstream.
    try {
        const body = (await request.clone().json()) as unknown;
        if (
            body &&
            typeof body === "object" &&
            "email" in body &&
            typeof (body as { email: unknown }).email === "string"
        ) {
            const email = (body as { email: string }).email
                .trim()
                .toLowerCase();
            return email.length > 0 ? email : null;
        }
    } catch {
        // Malformed/empty body -- let better-auth reject it; no email bucket.
    }
    return null;
}

function tooManyRequests(result: RateLimitResult): Response {
    const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );

    return Response.json(
        {
            message: `Too many attempts. Please wait ${retryAfter}s and try again.`,
            code: ErrorCode.RATE_LIMITED,
        },
        {
            status: 429,
            headers: {
                "Retry-After": retryAfter.toString(),
                "X-RateLimit-Limit": result.limit.toString(),
                "X-RateLimit-Remaining": result.remaining.toString(),
                "X-RateLimit-Reset": Math.ceil(
                    result.resetAt.getTime() / 1000,
                ).toString(),
            },
        },
    );
}

/**
 * Enforce per-IP (and where configured, per-email) rate limits on
 * better-auth email/password endpoints. Returns a 429 `Response` when the
 * request should be rejected, or `null` to let it through.
 */
export async function enforceAuthRateLimit(
    request: Request,
): Promise<Response | null> {
    const path = authPath(request);
    const rule = RULES[path];
    if (!rule) return null;

    // Only enforce the per-IP cap when we can actually distinguish clients.
    // `getClientIp` returns "unknown" when proxy-header trust is off
    // (`RATE_LIMIT_TRUST_PROXY_HEADERS` unset, the self-host default) or the
    // header is absent. Bucketing every client under one `unknown` key would
    // turn a low auth limit into a trivial cross-user lockout: one actor
    // burns the shared bucket and locks everyone out. Failing open on the IP
    // dimension here is the safer default -- the per-email cap below is
    // IP-independent and still guards the SMTP-burn vector, and operators who
    // want per-IP auth throttling set `RATE_LIMIT_TRUST_PROXY_HEADERS=true`
    // (already required under `IS_HOSTED`).
    const clientIp = getClientIp(request);
    if (clientIp !== "unknown") {
        const ipResult = await consumeRateLimitBucket(
            `auth:ip:${path}:${clientIp}`,
            { limit: rule.ipLimit, windowMs: WINDOW_MS },
        );
        if (!ipResult.allowed) return tooManyRequests(ipResult);
    }

    if (rule.emailLimit !== undefined) {
        const email = await readEmail(request);
        if (email) {
            const emailResult = await consumeRateLimitBucket(
                `auth:email:${path}:${email}`,
                { limit: rule.emailLimit, windowMs: WINDOW_MS },
            );
            if (!emailResult.allowed) return tooManyRequests(emailResult);
        }
    }

    return null;
}
