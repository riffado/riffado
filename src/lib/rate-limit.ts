import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiRateLimitBuckets } from "@/db/schema";
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
    const nowIso = now.toISOString();
    const resetAtIso = resetAt.toISOString();
    const [bucket] = await db
        .insert(apiRateLimitBuckets)
        .values({
            key: bucketKey(rawKey),
            count: 1,
            resetAt,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: apiRateLimitBuckets.key,
            set: {
                count: sql<number>`case when ${apiRateLimitBuckets.resetAt} <= ${nowIso} then 1 else ${apiRateLimitBuckets.count} + 1 end`,
                resetAt: sql<Date>`case when ${apiRateLimitBuckets.resetAt} <= ${nowIso} then ${resetAtIso} else ${apiRateLimitBuckets.resetAt} end`,
                updatedAt: now,
            },
        })
        .returning({
            count: apiRateLimitBuckets.count,
            resetAt: apiRateLimitBuckets.resetAt,
        });

    const count = bucket?.count ?? limit + 1;
    const bucketResetAt = bucket?.resetAt ?? resetAt;

    return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(limit - count, 0),
        resetAt: bucketResetAt,
    };
}
