import { NextResponse } from "next/server";
import { APIError as OpenAIAPIError } from "openai";

export enum ErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    AUTH_SESSION_MISSING = "AUTH_SESSION_MISSING",
    AUTH_SESSION_EXPIRED = "AUTH_SESSION_EXPIRED",

    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    INVALID_FILE_FORMAT = "INVALID_FILE_FORMAT",

    NOT_FOUND = "NOT_FOUND",
    ALREADY_EXISTS = "ALREADY_EXISTS",
    CONFLICT = "CONFLICT",

    PLAUD_CONNECTION_FAILED = "PLAUD_CONNECTION_FAILED",
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

    STORAGE_ERROR = "STORAGE_ERROR",
    STORAGE_QUOTA_EXCEEDED = "STORAGE_QUOTA_EXCEEDED",
    FILE_TOO_LARGE = "FILE_TOO_LARGE",
    PATH_TRAVERSAL_DETECTED = "PATH_TRAVERSAL_DETECTED",

    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED",
    NO_TRANSCRIPTION_PROVIDER = "NO_TRANSCRIPTION_PROVIDER",
    TRANSCRIPTION_API_ERROR = "TRANSCRIPTION_API_ERROR",

    AI_PROVIDER_NOT_CONFIGURED = "AI_PROVIDER_NOT_CONFIGURED",
    AI_PROVIDER_API_ERROR = "AI_PROVIDER_API_ERROR",
    AI_RATE_LIMITED = "AI_RATE_LIMITED",
    AI_CONTEXT_LENGTH_EXCEEDED = "AI_CONTEXT_LENGTH_EXCEEDED",

    RECORDING_NOT_FOUND = "RECORDING_NOT_FOUND",
    RECORDING_STREAM_INVALID_RANGE = "RECORDING_STREAM_INVALID_RANGE",

    EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED",
    SMTP_NOT_CONFIGURED = "SMTP_NOT_CONFIGURED",
    SMTP_AUTH_FAILED = "SMTP_AUTH_FAILED",
    NOTIFICATION_FAILED = "NOTIFICATION_FAILED",

    DATABASE_ERROR = "DATABASE_ERROR",
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
                console.error(`[api] [${errorId}]`, app.code, error);
            }
            return NextResponse.json(app.toJSON(), { status: app.statusCode });
        }
    };
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
        if (error.code === "context_length_exceeded") {
            return new AppError(
                ErrorCode.AI_CONTEXT_LENGTH_EXCEEDED,
                "Transcript is too long for the selected model's context window. Choose a model with a larger context or a different provider.",
                400,
            );
        }
        if (error.status === 429) {
            return new AppError(
                ErrorCode.AI_RATE_LIMITED,
                "Too many requests to the AI provider. Please try again later.",
                429,
            );
        }
        if (typeof error.status === "number" && error.status >= 500) {
            return new AppError(
                ErrorCode.UPSTREAM_BAD_RESPONSE,
                "The AI provider is temporarily unavailable. Please try again later.",
                502,
            );
        }
        return new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            error.message || "The AI provider rejected the request.",
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

        // Postgres SQLSTATE 23505 = unique_violation.
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
