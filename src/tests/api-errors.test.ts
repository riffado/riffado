/**
 * Unit tests for the client-side error envelope parser
 * (`src/lib/api-errors.ts`).
 *
 * Pins:
 *   - Well-formed envelopes round-trip (`{ error, code, details? }`).
 *   - Malformed bodies fall back to a synthetic envelope so callers
 *     always have `{ error, code }` to switch on.
 *   - `getApiErrorMessage` always returns a non-empty string.
 */

import { describe, expect, it } from "vitest";
import { getApiErrorMessage, parseApiError } from "@/lib/api-errors";
import { ErrorCode } from "@/lib/errors";

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("parseApiError", () => {
    it("parses { error, code, details } verbatim", async () => {
        const res = jsonResponse(400, {
            error: "Email is required",
            code: ErrorCode.MISSING_REQUIRED_FIELD,
            details: { field: "email" },
        });
        expect(await parseApiError(res)).toEqual({
            error: "Email is required",
            code: ErrorCode.MISSING_REQUIRED_FIELD,
            details: { field: "email" },
        });
    });

    it("parses envelopes without details", async () => {
        const res = jsonResponse(401, {
            error: "Unauthorized",
            code: ErrorCode.AUTH_SESSION_MISSING,
        });
        expect(await parseApiError(res)).toEqual({
            error: "Unauthorized",
            code: ErrorCode.AUTH_SESSION_MISSING,
        });
    });

    it("falls back to a synthetic envelope when JSON is malformed", async () => {
        const res = new Response("<!doctype html><h1>502</h1>", {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "Content-Type": "text/html" },
        });
        const parsed = await parseApiError(res);
        expect(parsed.code).toBe("UNKNOWN_ERROR");
        expect(parsed.error).toBe("Bad Gateway");
    });

    it("falls back when JSON lacks the required fields", async () => {
        const res = jsonResponse(500, { foo: "bar" });
        const parsed = await parseApiError(res);
        expect(parsed.code).toBe("UNKNOWN_ERROR");
    });
});

describe("getApiErrorMessage", () => {
    it("returns the envelope's error message", async () => {
        const res = jsonResponse(400, {
            error: "Invalid code",
            code: ErrorCode.PLAUD_OTP_INVALID,
        });
        expect(await getApiErrorMessage(res)).toBe("Invalid code");
    });

    it("returns a non-empty string even when the body is empty", async () => {
        // statusText is empty for `new Response("", { status: 500 })` so the
        // helper falls all the way through to its built-in default. Just
        // assert non-empty rather than the exact text.
        const res = new Response("", { status: 500 });
        const msg = await getApiErrorMessage(res, "fallback");
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });
});
