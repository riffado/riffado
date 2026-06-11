import { createHmac } from "node:crypto";
import { upsertRateLimitBucket } from "@/db/queries/rate-limit";
import { env } from "@/lib/env";

export type RateLimitResult = {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetAt: Date;
};

type RateLimitConfig = {
    limit: number;
    windowMs: number;
    now?: Date;
};

function rateLimitSecret(): string {
    const secret = env.API_TOKEN_HASH_SECRET ?? env.BETTER_AUTH_SECRET;
    if (!secret) {
        throw new Error("Rate limit secret is not configured");
    }
    return secret;
}

/**
 * HMAC the raw bucket key (user id, IP, token id, etc.) before it touches
 * the DB. The hosted DB is a multi-tenant blast surface: an exfil should
 * not let an attacker enumerate which users/IPs were rate-limited or
 * correlate buckets back to identities. HMAC keyed off
 * `API_TOKEN_HASH_SECRET` (falling back to `BETTER_AUTH_SECRET`) makes
 * this collision-resistant and unforgeable without the server secret.
 */
function bucketKey(rawKey: string): string {
    return createHmac("sha256", rateLimitSecret()).update(rawKey).digest("hex");
}

function firstForwardedForIp(value: string | null): string | null {
    if (!value) return null;
    for (const part of value.split(",")) {
        const trimmed = part.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

export function getClientIp(request: Request): string {
    if (!env.RATE_LIMIT_TRUST_PROXY_HEADERS) {
        return "unknown";
    }

    const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
    if (cloudflareIp) return cloudflareIp;

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;

    const forwardedFor = request.headers.get("x-forwarded-for");
    return firstForwardedForIp(forwardedFor) ?? "unknown";
}

export async function consumeRateLimitBucket(
    rawKey: string,
    { limit, windowMs, now = new Date() }: RateLimitConfig,
): Promise<RateLimitResult> {
    const resetAt = new Date(now.getTime() + windowMs);

    // Fail-open: if the bucket store is unreachable (DB down, query error,
    // driver crash) we MUST NOT take down every rate-limited route with
    // it. The whole point of the rate-limiter is to be a safety net; a
    // broken safety net should not collapse the building. Log loudly so
    // Sentry surfaces the outage, then allow the request through with
    // synthetic headers that look like a full bucket.
    //
    // Trade-off: under a sustained bucket-store outage an attacker could
    // burst past nominal limits. That's the correct trade vs. taking the
    // API down -- the upstream (Cloudflare, ALB) still rate-limits at
    // the edge, and the v1 surface has per-token auth as a second gate.
    let bucket: Awaited<ReturnType<typeof upsertRateLimitBucket>>;
    try {
        bucket = await upsertRateLimitBucket({
            key: bucketKey(rawKey),
            now,
            resetAt,
        });
    } catch (error) {
        console.warn(
            "[rate-limit] bucket store unavailable; failing open",
            error instanceof Error ? error.message : error,
        );
        return {
            allowed: true,
            limit,
            remaining: limit,
            resetAt,
        };
    }

    const count = bucket?.count ?? limit + 1;
    const bucketResetAt = bucket?.resetAt ?? resetAt;

    return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(limit - count, 0),
        resetAt: bucketResetAt,
    };
}
