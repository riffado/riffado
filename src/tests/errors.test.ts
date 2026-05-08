/**
 * Unit tests for the unified error envelope (`src/lib/errors.ts`).
 *
 * Pins:
 *   - `AppError.toJSON` shape (with / without details)
 *   - `errorResponse` returns the right body + status for AppError, plain
 *     Error (mapped via patterns), and unknown values
 *   - `mapErrorToAppError` covers each known pattern and the
 *     no-internal-message-leak fallback
 *   - `apiHandler` happy path passes through, error path returns the
 *     envelope, and `>=500` errors are logged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AppError,
    apiHandler,
    createErrorResponse,
    ErrorCode,
    errorResponse,
    mapErrorToAppError,
} from "@/lib/errors";

describe("AppError.toJSON", () => {
    it("emits { error, code } with no details", () => {
        const err = new AppError(ErrorCode.NOT_FOUND, "Missing", 404);
        expect(err.toJSON()).toEqual({
            error: "Missing",
            code: ErrorCode.NOT_FOUND,
        });
    });

    it("emits { error, code, details } when details are present", () => {
        const err = new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Email is required",
            400,
            { field: "email" },
        );
        expect(err.toJSON()).toEqual({
            error: "Email is required",
            code: ErrorCode.MISSING_REQUIRED_FIELD,
            details: { field: "email" },
        });
    });
});

describe("mapErrorToAppError", () => {
    it("passes AppError through verbatim", () => {
        const original = new AppError(ErrorCode.PLAUD_API_ERROR, "x", 400, {
            plaudStatus: 422,
        });
        expect(mapErrorToAppError(original)).toBe(original);
    });

    it("maps 'path traversal' -> PATH_TRAVERSAL_DETECTED 400", () => {
        const r = mapErrorToAppError(new Error("attempted path traversal"));
        expect(r.code).toBe(ErrorCode.PATH_TRAVERSAL_DETECTED);
        expect(r.statusCode).toBe(400);
        expect(r.message).toBe("Invalid file path detected");
    });

    it("maps unique-constraint -> UNIQUE_CONSTRAINT_VIOLATION 409", () => {
        const r = mapErrorToAppError(
            new Error("unique constraint failed on column"),
        );
        expect(r.code).toBe(ErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
        expect(r.statusCode).toBe(409);
    });

    it("maps legacy 'Plaud API error (429): ...' -> PLAUD_RATE_LIMITED 429", () => {
        const r = mapErrorToAppError(
            new Error("Plaud API error (429): too many"),
        );
        expect(r.code).toBe(ErrorCode.PLAUD_RATE_LIMITED);
        expect(r.statusCode).toBe(429);
    });

    it("maps legacy 'Plaud API error (5xx): ...' -> PLAUD_UPSTREAM_ERROR 502", () => {
        const r = mapErrorToAppError(
            new Error("Plaud API error (503): unavailable"),
        );
        expect(r.code).toBe(ErrorCode.PLAUD_UPSTREAM_ERROR);
        expect(r.statusCode).toBe(502);
    });

    it("maps legacy 'Plaud API error (4xx): ...' -> PLAUD_API_ERROR 400 with plaudStatus", () => {
        const r = mapErrorToAppError(
            new Error("Plaud API error (403): forbidden workspace"),
        );
        expect(r.code).toBe(ErrorCode.PLAUD_API_ERROR);
        expect(r.statusCode).toBe(400);
        expect(r.message).toBe("forbidden workspace");
        expect(r.details).toEqual({ plaudStatus: 403 });
    });

    it("maps bare 'Plaud API error: ...' -> PLAUD_API_ERROR 400", () => {
        const r = mapErrorToAppError(new Error("Plaud API error: invalid OTP"));
        expect(r.code).toBe(ErrorCode.PLAUD_API_ERROR);
        expect(r.statusCode).toBe(400);
        expect(r.message).toBe("invalid OTP");
    });

    it("maps SMTP authentication -> SMTP_AUTH_FAILED", () => {
        const r = mapErrorToAppError(new Error("SMTP authentication failed"));
        expect(r.code).toBe(ErrorCode.SMTP_AUTH_FAILED);
    });

    it("maps SMTP not configured -> SMTP_NOT_CONFIGURED", () => {
        const r = mapErrorToAppError(new Error("SMTP not configured"));
        expect(r.code).toBe(ErrorCode.SMTP_NOT_CONFIGURED);
    });

    it("maps storage failure -> STORAGE_ERROR", () => {
        const r = mapErrorToAppError(new Error("local storage write failed"));
        expect(r.code).toBe(ErrorCode.STORAGE_ERROR);
    });

    it("maps transcription failure -> TRANSCRIPTION_FAILED", () => {
        const r = mapErrorToAppError(new Error("transcription provider died"));
        expect(r.code).toBe(ErrorCode.TRANSCRIPTION_FAILED);
    });

    it("does NOT leak internal message on unmapped Error", () => {
        const r = mapErrorToAppError(
            new Error("connection to db at host=secret-internal failed"),
        );
        expect(r.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(r.statusCode).toBe(500);
        expect(r.message).toBe("An unexpected error occurred");
        expect(r.message).not.toContain("secret-internal");
    });

    it("always falls back to INTERNAL_ERROR for unknown thrown values", () => {
        // No `defaultCode` plumbing: domain codes must travel on the
        // thrown AppError. An unmapped throw is by definition our bug,
        // and labeling a 500 with e.g. PLAUD_API_ERROR would mislead
        // clients about whose problem it is.
        const r = mapErrorToAppError("oops");
        expect(r.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(r.statusCode).toBe(500);
        expect(r.message).toBe("An unexpected error occurred");
    });

    it("maps pg unique_violation (code 23505) -> UNIQUE_CONSTRAINT_VIOLATION", () => {
        const pgErr = Object.assign(new Error("some wrapped message"), {
            code: "23505",
        });
        const r = mapErrorToAppError(pgErr);
        expect(r.code).toBe(ErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
        expect(r.statusCode).toBe(409);
    });

    it("maps wrapped pg error via .cause.code", () => {
        const inner = Object.assign(new Error("inner"), { code: "23505" });
        const outer = Object.assign(new Error("wrapped"), { cause: inner });
        const r = mapErrorToAppError(outer);
        expect(r.code).toBe(ErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
    });
});

describe("errorResponse", () => {
    it("returns NextResponse with AppError's status + body", async () => {
        const res = errorResponse(
            new AppError(ErrorCode.PLAUD_OTP_INVALID, "Invalid code", 400, {
                plaudStatus: -1,
            }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "Invalid code",
            code: ErrorCode.PLAUD_OTP_INVALID,
            details: { plaudStatus: -1 },
        });
    });

    it("falls back to 500 INTERNAL_ERROR for unknown thrown values", async () => {
        const res = errorResponse({ weird: "shape" });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
            error: "An unexpected error occurred",
            code: ErrorCode.INTERNAL_ERROR,
        });
    });
});

describe("createErrorResponse (legacy shape)", () => {
    it("returns { body, status } and shares the mapping path", () => {
        const r = createErrorResponse(
            new AppError(ErrorCode.NOT_FOUND, "gone", 404),
        );
        expect(r.status).toBe(404);
        expect(r.body).toEqual({ error: "gone", code: ErrorCode.NOT_FOUND });
    });
});

describe("apiHandler", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("passes through Response on the happy path", async () => {
        const handler = apiHandler(async () => new Response("ok"));
        const res = await handler(new Request("http://x"), undefined);
        expect(await res.text()).toBe("ok");
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("converts thrown AppError to the unified envelope", async () => {
        const handler = apiHandler(async () => {
            throw new AppError(
                ErrorCode.AUTH_SESSION_MISSING,
                "Unauthorized",
                401,
            );
        });
        const res = await handler(new Request("http://x"), undefined);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
            error: "Unauthorized",
            code: ErrorCode.AUTH_SESSION_MISSING,
        });
        // 401 is < 500, no error log.
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("does NOT double-wrap an AppError thrown from a nested helper", async () => {
        const original = new AppError(
            ErrorCode.PLAUD_OTP_INVALID,
            "bad code",
            400,
            { plaudStatus: -1 },
        );
        const handler = apiHandler(async () => {
            throw original;
        });
        const res = await handler(new Request("http://x"), undefined);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "bad code",
            code: ErrorCode.PLAUD_OTP_INVALID,
            details: { plaudStatus: -1 },
        });
    });

    it("`details` carry only whitelisted fields, not raw upstream bodies", async () => {
        // Regression guard: if a helper ever splats an upstream body into
        // `details` (e.g. `details: body`), upstream secrets / PII could
        // leak into the response.
        const err = new AppError(
            ErrorCode.PLAUD_OTP_INVALID,
            "Invalid code",
            400,
            { plaudStatus: -1 },
        );
        const handler = apiHandler(async () => {
            throw err;
        });
        const res = await handler(new Request("http://x"), undefined);
        const body = (await res.json()) as {
            details?: Record<string, unknown>;
        };
        expect(body.details).toBeDefined();
        expect(Object.keys(body.details ?? {})).toEqual(["plaudStatus"]);
    });

    it("logs >=500 errors but never leaks internal message in body", async () => {
        const handler = apiHandler(async () => {
            throw new Error("DATABASE host=internal pw=hunter2");
        });
        const res = await handler(new Request("http://x"), undefined);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe("An unexpected error occurred");
        expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(JSON.stringify(body)).not.toContain("hunter2");
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
