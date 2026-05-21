import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ErrorCode } from "@/lib/errors";
import { consumeRateLimitBucket } from "@/lib/rate-limit";

const WINDOW_MS = 60_000;

/** Per-user rate limit for `POST /api/plaud/sync`. Returns null when allowed, or a 429 response. */
export async function enforcePlaudSyncRateLimit(
    userId: string,
): Promise<NextResponse | null> {
    const limit = env.PLAUD_SYNC_RATE_LIMIT_PER_MINUTE;
    const result = await consumeRateLimitBucket(`plaud-sync:user:${userId}`, {
        limit,
        windowMs: WINDOW_MS,
    });

    if (result.allowed) return null;

    const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );
    const resetAt = Math.ceil(result.resetAt.getTime() / 1000);

    return NextResponse.json(
        {
            error: "You are syncing too often. Please wait a moment and try again.",
            code: ErrorCode.RATE_LIMITED,
            details: {
                retryAfter,
                limit: result.limit,
                remaining: result.remaining,
                resetAt,
            },
        },
        {
            status: 429,
            headers: {
                "Retry-After": retryAfter.toString(),
                "X-RateLimit-Limit": result.limit.toString(),
                "X-RateLimit-Remaining": result.remaining.toString(),
                "X-RateLimit-Reset": resetAt.toString(),
            },
        },
    );
}
