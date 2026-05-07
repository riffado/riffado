import { NextResponse } from "next/server";
import type { AuthenticatedRequest } from "@/lib/auth-request";
import {
    consumeRateLimitBucket,
    getClientIp,
    type RateLimitResult,
} from "@/lib/rate-limit";

const WINDOW_MS = 60_000;
const IP_LIMIT = 1_200;
const AUTHENTICATED_LIMIT = 600;

export { getClientIp };

function rateLimitResponse(result: RateLimitResult): NextResponse {
    const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );

    return NextResponse.json(
        { error: "Rate limit exceeded" },
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

export async function enforceV1IpRateLimit(
    request: Request,
): Promise<NextResponse | null> {
    const result = await consumeRateLimitBucket(
        `v1:ip:${getClientIp(request)}`,
        {
            limit: IP_LIMIT,
            windowMs: WINDOW_MS,
        },
    );
    return result.allowed ? null : rateLimitResponse(result);
}

export async function enforceV1AuthenticatedRateLimit(
    authn: AuthenticatedRequest,
): Promise<NextResponse | null> {
    const identity =
        authn.via === "token" && authn.tokenId
            ? `token:${authn.tokenId}`
            : `user:${authn.user.id}`;
    const result = await consumeRateLimitBucket(`v1:auth:${identity}`, {
        limit: AUTHENTICATED_LIMIT,
        windowMs: WINDOW_MS,
    });
    return result.allowed ? null : rateLimitResponse(result);
}
