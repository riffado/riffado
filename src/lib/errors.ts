import { NextResponse } from "next/server";
import { APIError as OpenAIAPIError } from "openai";
import { captureServerException } from "@/lib/posthog-server";

export enum ErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED",
    ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
    AUTH_SESSION_MISSING = "AUTH_SESSION_MISSING",

    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    INVALID_FILE_FORMAT = "INVALID_FILE_FORMAT",

    NOT_FOUND = "NOT_FOUND",
    ALREADY_EXISTS = "ALREADY_EXISTS",
    CONFLICT = "CONFLICT",

    PLAUD_INVALID_TOKEN = "PLAUD_INVALID_TOKEN",
    PLAUD_API_ERROR = "PLAUD_API_ERROR",
    PLAUD_UPSTREAM_ERROR = "PLAUD_UPSTREAM_ERROR",
    PLAUD_RATE_LIMITED = "PLAUD_RATE_LIMITED",
    PLAUD_OTP_INVALID = "PLAUD_OTP_INVALID",
    PLAUD_OTP_EXPIRED = "PLAUD_OTP_EXPIRED",
    PLAUD_INVALID_API_BASE = "PLAUD_INVALID_API_BASE",
    PLAUD_REGION_REDIRECT_LOOP = "PLAUD_REGION_REDIRECT_LOOP",
    PLAUD_NOT_CONNECTED = "PLAUD_NOT_CONNECTED",
    PLAUD_WORKSPACE_UNAVAILABLE = "PLAUD_WORKSPACE_UNAVAILABLE",
    PLAUD_WORKSPACE_TOKEN_PASTED = "PLAUD_WORKSPACE_TOKEN_PASTED",

    STORAGE_ERROR = "STORAGE_ERROR",
    STORAGE_QUOTA_EXCEEDED = "STORAGE_QUOTA_EXCEEDED",
    FILE_TOO_LARGE = "FILE_TOO_LARGE",
    PATH_TRAVERSAL_DETECTED = "PATH_TRAVERSAL_DETECTED",

    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED",
    NO_TRANSCRIPTION_PROVIDER = "NO_TRANSCRIPTION_PROVIDER",
    /** Hosted-only: a user's included Mynah transcription budget for the cycle is exhausted. */
    MYNAH_BUDGET_EXHAUSTED = "MYNAH_BUDGET_EXHAUSTED",

    AI_PROVIDER_NOT_CONFIGURED = "AI_PROVIDER_NOT_CONFIGURED",
    AI_PROVIDER_API_ERROR = "AI_PROVIDER_API_ERROR",
    AI_RATE_LIMITED = "AI_RATE_LIMITED",
    AI_CONTEXT_LENGTH_EXCEEDED = "AI_CONTEXT_LENGTH_EXCEEDED",

    RECORDING_NOT_FOUND = "RECORDING_NOT_FOUND",
    RECORDING_STREAM_INVALID_RANGE = "RECORDING_STREAM_INVALID_RANGE",

    EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED",
    SMTP_NOT_CONFIGURED = "SMTP_NOT_CONFIGURED",
    SMTP_AUTH_FAILED = "SMTP_AUTH_FAILED",

    UNIQUE_CONSTRAINT_VIOLATION = "UNIQUE_CONSTRAINT_VIOLATION",

    INTERNAL_ERROR = "INTERNAL_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    RATE_LIMITED = "RATE_LIMITED",
    UPSTREAM_BAD_RESPONSE = "UPSTREAM_BAD_RESPONSE",
}

export interface AppErrorJSON {
    error: string;
    code: ErrorCode;
    details?: Record<string, unknown>;
}

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

export function createErrorResponse(error: AppError | Error | unknown): {
    body: AppErrorJSON;
    status: number;
} {
    const app = mapErrorToAppError(error);
    return { body: app.toJSON(), status: app.statusCode };
}

export function errorResponse(error: AppError | Error | unknown): NextResponse {
    const app = mapErrorToAppError(error);
    if (app.statusCode >= 500) {
        const errorId = attachErrorId(app);
        console.error(`[api] [${errorId}]`, app.code, error);
        captureServerException(error, {
            source: "api",
            errorId,
            code: app.code,
        });
    }
    return NextResponse.json(app.toJSON(), { status: app.statusCode });
}

type RouteHandler<Ctx> = (
    request: Request,
    context?: Ctx,
) => Promise<Response> | Response;

/** Wrap a route handler so thrown errors become the unified envelope. */
export function apiHandler<Ctx = unknown>(
    handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
    return async (request, context) => {
        try {
            return await handler(request, context);
        } catch (error) {
            const app = mapErrorToAppError(error);
            if (app.statusCode >= 500) {
                const errorId = attachErrorId(app);
                const pathname = safePathname(request);
                console.error(
                    `[api] [${errorId}] ${request.method} ${pathname}`,
                    app.code,
                    error,
                );
                captureServerException(error, {
                    source: "api",
                    errorId,
                    code: app.code,
                    route: pathname,
                    method: request.method,
                });
            }
            return NextResponse.json(app.toJSON(), { status: app.statusCode });
        }
    };
}

/** Path only -- strips query string/fragment so no request data leaks into error properties. */
function safePathname(request: Request): string {
    try {
        return new URL(request.url).pathname;
    } catch {
        return "<invalid-url>";
    }
}

// Detect a context-window-overflow error across OpenAI-compatible
// providers. OpenAI/Groq use the `context_length_exceeded` code, but
// providers reached through a custom `baseURL` (OpenRouter, Together,
// local servers) report it under different codes or only in the message,
// so we also match on common message phrasing. Used purely for
// classification; the outbound message is always our own fixed copy.
function isContextLengthError(error: OpenAIAPIError): boolean {
    const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
    if (
        code.includes("context_length") ||
        code.includes("context_window") ||
        code === "string_above_max_length"
    ) {
        return true;
    }
    const message = (error.message ?? "").toLowerCase();
    return (
        message.includes("context length") ||
        message.includes("context window") ||
        message.includes("maximum context") ||
        message.includes("too many tokens") ||
        message.includes("reduce the length")
    );
}

function attachErrorId(app: AppError): string {
    const existing = app.details?.errorId;
    if (typeof existing === "string" && existing.startsWith("err_")) {
        return existing;
    }
    const errorId = `err_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    app.details = { ...(app.details ?? {}), errorId };
    return errorId;
}

export function mapErrorToAppError(error: unknown): AppError {
    if (error instanceof AppError) {
        return error;
    }

    // Errors from any OpenAI-compatible provider (summary, title, etc.).
    // Surface a useful message instead of a generic 500 -- the common case
    // is an over-long transcript exceeding the model's context window.
    if (error instanceof OpenAIAPIError) {
        const status =
            typeof error.status === "number" ? error.status : undefined;

        if (isContextLengthError(error)) {
            return new AppError(
                ErrorCode.AI_CONTEXT_LENGTH_EXCEEDED,
                "Transcript is too long for the selected model's context window. Choose a model with a larger context or a different provider.",
                400,
            );
        }
        if (status === 429) {
            return new AppError(
                ErrorCode.AI_RATE_LIMITED,
                "Too many requests to the AI provider. Please try again later.",
                429,
            );
        }
        // No HTTP status means a connection/transport failure (DNS, TLS,
        // timeout) -- the provider was never reached. That is upstream
        // unavailability, not a client error, so it maps the same as a
        // provider 5xx.
        if (status === undefined || status >= 500) {
            return new AppError(
                ErrorCode.UPSTREAM_BAD_RESPONSE,
                "The AI provider is temporarily unavailable. Please try again later.",
                502,
            );
        }
        // Other 4xx: a generic provider rejection. Never echo the raw
        // provider message back to the client -- it can carry upstream
        // request details (or key fragments). Keep the detail server-side.
        return new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "The AI provider rejected the request.",
            400,
        );
    }

    if (error instanceof Error) {
        if (error.message.includes("path traversal")) {
            return new AppError(
                ErrorCode.PATH_TRAVERSAL_DETECTED,
                "Invalid file path detected",
                400,
            );
        }

        // Postgres SQLSTATE 23505 = unique_violation. Deliberately NOT
        // matched on message substrings like "unique"/"duplicate" -- a
        // genuine 500-class bug whose message happens to contain those
        // words would otherwise get silently downgraded to a 409 with no
        // errorId and no log line.
        const pgCode = (error as { code?: unknown; cause?: { code?: unknown } })
            .code;
        const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
        if (pgCode === "23505" || causeCode === "23505") {
            return new AppError(
                ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
                "This resource already exists",
                409,
            );
        }

        if (error.name === "MynahBudgetExhaustedError") {
            return new AppError(
                ErrorCode.MYNAH_BUDGET_EXHAUSTED,
                "You've used all of your included Mynah transcription for this cycle. It resets next cycle, or add your own AI provider to keep transcribing.",
                402,
            );
        }

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

        // NOTE: message-substring matching below is fragile by
        // construction -- an error whose message happens to contain both
        // "storage" and "transcription" (e.g. a Mynah storage-config
        // error) will match whichever check runs first, not necessarily
        // the correct category. Known limitation; prefer throwing a typed
        // error (see MynahBudgetExhaustedError above) over adding more
        // substrings here.
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

    return new AppError(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred",
        500,
    );
}
