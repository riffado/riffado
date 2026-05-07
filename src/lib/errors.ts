/**
 * Standardized error envelope for every API route.
 *
 * Wire shape (the contract clients depend on):
 *
 *     { "error": "human message", "code": "MACHINE_READABLE", "details"?: {...} }
 *
 *  - `error`   — human-readable, safe to display, never contains stack
 *                traces, secrets, DB internals, or upstream payloads.
 *  - `code`    — stable, SCREAMING_SNAKE_CASE, grouped by domain prefix.
 *                Treat the enum as a public API contract: never repurpose
 *                a shipped value, only add new ones (and deprecate old).
 *  - `details` — optional, machine-readable extras (`{ field, retryAfter,
 *                plaudStatus }`). Whitelist named fields only — never
 *                splat in upstream objects, they may carry secrets.
 *
 * Status codes mirror `AppError.statusCode`:
 *   400 invalid input · 401 unauthenticated · 403 forbidden · 404 not found
 *   409 conflict · 413 too large · 416 range invalid · 429 rate limited
 *   502 upstream broken (Plaud, AI provider) · 500 our bug
 *
 * See `docs/error-codes.md` for the full per-code reference.
 */

import { NextResponse } from "next/server";

export enum ErrorCode {
    // Auth ------------------------------------------------------------------
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    AUTH_SESSION_MISSING = "AUTH_SESSION_MISSING",
    AUTH_SESSION_EXPIRED = "AUTH_SESSION_EXPIRED",

    // Input -----------------------------------------------------------------
    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    INVALID_FILE_FORMAT = "INVALID_FILE_FORMAT",

    // Resource --------------------------------------------------------------
    NOT_FOUND = "NOT_FOUND",
    ALREADY_EXISTS = "ALREADY_EXISTS",
    CONFLICT = "CONFLICT",

    // Plaud -----------------------------------------------------------------
    PLAUD_CONNECTION_FAILED = "PLAUD_CONNECTION_FAILED",
    PLAUD_INVALID_TOKEN = "PLAUD_INVALID_TOKEN",
    PLAUD_API_ERROR = "PLAUD_API_ERROR", // 4xx-from-Plaud, user-actionable
    PLAUD_UPSTREAM_ERROR = "PLAUD_UPSTREAM_ERROR", // 5xx-from-Plaud or our infra
    PLAUD_RATE_LIMITED = "PLAUD_RATE_LIMITED",
    PLAUD_OTP_INVALID = "PLAUD_OTP_INVALID",
    PLAUD_OTP_EXPIRED = "PLAUD_OTP_EXPIRED",
    PLAUD_INVALID_API_BASE = "PLAUD_INVALID_API_BASE", // SSRF guard
    PLAUD_REGION_REDIRECT_LOOP = "PLAUD_REGION_REDIRECT_LOOP",
    PLAUD_NOT_CONNECTED = "PLAUD_NOT_CONNECTED",
    PLAUD_WORKSPACE_UNAVAILABLE = "PLAUD_WORKSPACE_UNAVAILABLE",

    // Storage ---------------------------------------------------------------
    STORAGE_ERROR = "STORAGE_ERROR",
    STORAGE_QUOTA_EXCEEDED = "STORAGE_QUOTA_EXCEEDED",
    FILE_TOO_LARGE = "FILE_TOO_LARGE",
    PATH_TRAVERSAL_DETECTED = "PATH_TRAVERSAL_DETECTED",

    // Transcription ---------------------------------------------------------
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED",
    NO_TRANSCRIPTION_PROVIDER = "NO_TRANSCRIPTION_PROVIDER",
    TRANSCRIPTION_API_ERROR = "TRANSCRIPTION_API_ERROR",

    // AI providers (declared now, used in Phase 3) --------------------------
    AI_PROVIDER_NOT_CONFIGURED = "AI_PROVIDER_NOT_CONFIGURED",
    AI_PROVIDER_API_ERROR = "AI_PROVIDER_API_ERROR",
    AI_RATE_LIMITED = "AI_RATE_LIMITED",

    // Recordings (declared now, used in Phase 3) ----------------------------
    RECORDING_NOT_FOUND = "RECORDING_NOT_FOUND",
    RECORDING_STREAM_INVALID_RANGE = "RECORDING_STREAM_INVALID_RANGE",

    // Notifications ---------------------------------------------------------
    EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED",
    SMTP_NOT_CONFIGURED = "SMTP_NOT_CONFIGURED",
    SMTP_AUTH_FAILED = "SMTP_AUTH_FAILED",
    NOTIFICATION_FAILED = "NOTIFICATION_FAILED",

    // DB --------------------------------------------------------------------
    DATABASE_ERROR = "DATABASE_ERROR",
    UNIQUE_CONSTRAINT_VIOLATION = "UNIQUE_CONSTRAINT_VIOLATION",

    // Generic ---------------------------------------------------------------
    INTERNAL_ERROR = "INTERNAL_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    RATE_LIMITED = "RATE_LIMITED",
}

export interface AppErrorJSON {
    error: string;
    code: ErrorCode;
    details?: Record<string, unknown>;
}

/**
 * Application error with machine-readable code + intended HTTP status.
 *
 * Always throw `AppError` (not plain `Error`) from helpers reachable by
 * route handlers. The `errorResponse` / `apiHandler` machinery preserves
 * the code/status verbatim — plain `Error`s fall through `mapErrorToAppError`
 * and end up as a generic 500.
 */
export class AppError extends Error {
    constructor(
        public code: ErrorCode,
        message: string,
        public statusCode: number = 500,
        public details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "AppError";
    }

    toJSON(): AppErrorJSON {
        return {
            error: this.message,
            code: this.code,
            ...(this.details && { details: this.details }),
        };
    }
}

/**
 * Legacy helper kept for backwards compatibility with older callers.
 * New code should prefer `errorResponse` or `apiHandler`.
 */
export function createErrorResponse(error: AppError | Error | unknown): {
    body: AppErrorJSON;
    status: number;
} {
    const app = mapErrorToAppError(error);
    return { body: app.toJSON(), status: app.statusCode };
}

/**
 * Return a `NextResponse` carrying the unified error envelope. This is the
 * one-line catch-block helper for routes that don't use `apiHandler`.
 */
export function errorResponse(error: AppError | Error | unknown): NextResponse {
    const app = mapErrorToAppError(error);
    return NextResponse.json(app.toJSON(), { status: app.statusCode });
}

type RouteHandler<Ctx> = (
    request: Request,
    context?: Ctx,
) => Promise<Response> | Response;

/**
 * Wrap a route handler with unified error handling.
 *
 *     export const POST = apiHandler(async (request) => { ... });
 *
 * The wrapper:
 *   - lets `Response`s pass through unchanged (success path, redirects)
 *   - catches anything thrown, runs it through `mapErrorToAppError`, and
 *     returns the unified envelope with the right status code
 *   - logs `>=500` errors via `console.error` (Sentry hook can wire in
 *     here later — `console.error` is already what the codebase uses
 *     today, so this is no regression)
 *   - never lets internal `Error.message` leak: unmapped errors fall back
 *     to `INTERNAL_ERROR` with a generic public message.
 *
 * Routes do not pass a default code: unmapped failures are always
 * `INTERNAL_ERROR` (500). Domain-specific codes must be carried by the
 * thrown `AppError` itself — a 500 labeled `AI_PROVIDER_API_ERROR` would
 * mislead clients into thinking the provider failed when really our
 * handler crashed.
 */
export function apiHandler<Ctx = unknown>(
    handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
    return async (request, context) => {
        try {
            return await handler(request, context);
        } catch (error) {
            const app = mapErrorToAppError(error);
            if (app.statusCode >= 500) {
                console.error("[api]", app.code, error);
            }
            return NextResponse.json(app.toJSON(), { status: app.statusCode });
        }
    };
}

/**
 * Map an arbitrary thrown value into an `AppError`.
 *
 * Order of preference:
 *   1. `AppError` — passed through verbatim (this is the path we want
 *      every helper to land on going forward).
 *   2. Known string patterns from third-party libs we can't change
 *      (drizzle "unique"/"duplicate", legacy "Plaud API error" strings,
 *      SMTP, storage, transcription, path traversal). Kept as a fallback
 *      so partially-migrated code still maps to a sensible code.
 *   3. Anything else → `INTERNAL_ERROR` with a generic message. The
 *      original `Error.message` is intentionally NOT placed in the
 *      response — internal stack traces / DB errors / provider secrets
 *      must not leak. Use server logs for the original.
 */
export function mapErrorToAppError(error: unknown): AppError {
    if (error instanceof AppError) {
        return error;
    }

    if (error instanceof Error) {
        if (error.message.includes("path traversal")) {
            return new AppError(
                ErrorCode.PATH_TRAVERSAL_DETECTED,
                "Invalid file path detected",
                400,
            );
        }

        // Postgres SQLSTATE 23505 = unique_violation. node-postgres /
        // postgres-js / drizzle all surface the underlying pg error with
        // its `code` property intact (sometimes via `.cause`). Prefer the
        // typed signal; fall back to substring matching only for adapters
        // that wrap the original error.
        const pgCode = (error as { code?: unknown; cause?: { code?: unknown } })
            .code;
        const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
        if (
            pgCode === "23505" ||
            causeCode === "23505" ||
            error.message.includes("unique") ||
            error.message.includes("duplicate")
        ) {
            return new AppError(
                ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
                "This resource already exists",
                409,
            );
        }

        // Legacy `Plaud API error (NNN): ...` / `Plaud API error: ...`
        // strings. Phase-2 helpers throw `AppError` directly and bypass
        // this branch entirely; this remains as a safety net for any
        // un-migrated callsite.
        if (error.message.includes("Plaud API error")) {
            const match = /^Plaud API error \((\d{3})\):/.exec(error.message);
            if (match) {
                const status = Number.parseInt(match[1], 10);
                if (status === 429) {
                    return new AppError(
                        ErrorCode.PLAUD_RATE_LIMITED,
                        "Too many requests to Plaud. Please try again later.",
                        429,
                    );
                }
                if (status >= 500) {
                    return new AppError(
                        ErrorCode.PLAUD_UPSTREAM_ERROR,
                        "Plaud is temporarily unavailable. Please try again later.",
                        502,
                    );
                }
                return new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    error.message.replace(/^Plaud API error \(\d{3}\):\s*/, ""),
                    400,
                    { plaudStatus: status },
                );
            }
            // Bare `Plaud API error: ...` — business-level (HTTP 200 with
            // status:-N), user-actionable.
            return new AppError(
                ErrorCode.PLAUD_API_ERROR,
                error.message.replace(/^Plaud API error:\s*/, ""),
                400,
            );
        }

        if (error.message.includes("SMTP")) {
            if (error.message.includes("authentication")) {
                return new AppError(
                    ErrorCode.SMTP_AUTH_FAILED,
                    "Email authentication failed. Please check your SMTP credentials.",
                    500,
                );
            }
            if (error.message.includes("not configured")) {
                return new AppError(
                    ErrorCode.SMTP_NOT_CONFIGURED,
                    "Email service is not configured",
                    500,
                );
            }
            return new AppError(
                ErrorCode.EMAIL_SEND_FAILED,
                "Failed to send email notification. Please check your email settings.",
                500,
            );
        }

        if (error.message.includes("storage")) {
            return new AppError(
                ErrorCode.STORAGE_ERROR,
                "Failed to access storage. Please contact support if this persists.",
                500,
            );
        }

        if (error.message.includes("transcription")) {
            return new AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Failed to transcribe recording. Please try again or check your API configuration.",
                500,
            );
        }
    }

    // Unmapped: do NOT reflect the raw message — generic public message,
    // log internally for diagnosis. Always INTERNAL_ERROR; domain-specific
    // codes must travel on the thrown `AppError` itself.
    return new AppError(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred",
        500,
    );
}
