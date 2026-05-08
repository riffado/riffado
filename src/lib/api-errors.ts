/**
 * Client-side helper for the unified API error envelope.
 *
 * The server (`src/lib/errors.ts` + `apiHandler`) returns:
 *
 *     { error: string, code: ErrorCode, details?: Record<string, unknown> }
 *
 * on every failure. Use these helpers from React components / hooks /
 * the future mobile app so we never go back to string-matching on the
 * human-readable `error` field. Switch on `code` instead.
 *
 * See `docs/error-codes.md` for the full code reference.
 */

import type { ErrorCode } from "@/lib/errors";

export interface ApiErrorBody {
    error: string;
    code: ErrorCode | string; // string fallback for older / out-of-band errors
    details?: Record<string, unknown>;
}

/**
 * Parse a non-OK `Response` into the unified error envelope. Tolerant of
 * upstream proxies that occasionally drop the JSON body or replace it with
 * HTML (5xx error pages from a load balancer, etc.) — falls back to a
 * synthetic envelope so the caller always has `{ error, code }` to switch
 * on.
 */
export async function parseApiError(response: Response): Promise<ApiErrorBody> {
    try {
        const body = (await response.json()) as Partial<ApiErrorBody>;
        if (
            body &&
            typeof body.error === "string" &&
            typeof body.code === "string"
        ) {
            return {
                error: body.error,
                code: body.code,
                ...(body.details && { details: body.details }),
            };
        }
    } catch {
        // fall through
    }
    return {
        error: response.statusText || "Request failed",
        code: "UNKNOWN_ERROR",
    };
}

/**
 * Sugar for the common case: "I just want a string to show in a toast."
 * Always returns a non-empty string.
 */
export async function getApiErrorMessage(
    response: Response,
    fallback = "Request failed",
): Promise<string> {
    const body = await parseApiError(response);
    return body.error || fallback;
}
