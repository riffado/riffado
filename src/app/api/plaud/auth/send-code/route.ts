import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { plaudSendCode } from "@/lib/plaud/auth";

/**
 * POST /api/plaud/auth/send-code
 *
 * Proxies the OTP request to Plaud's API. The email and OTP token
 * pass straight through — we don't store either.
 *
 * Errors flow through `apiHandler`: `plaudSendCode` throws structured
 * `AppError`s (PLAUD_API_ERROR / PLAUD_REGION_REDIRECT_LOOP / ...) and
 * the wrapper converts them into the unified envelope with the right
 * status code. No more "Plaud API error:" prefix string-matching.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/send-code/route.ts
 */
export const POST = apiHandler(async (request: Request) => {
    await requireApiSession(request);

    // Tolerate malformed / null bodies: bad JSON from a client is a 400
    // input error, not a 500 server error. Without the catch,
    // request.json() throws SyntaxError and apiHandler maps it to
    // INTERNAL_ERROR.
    const body = (await request.json().catch(() => null)) as {
        email?: unknown;
    } | null;
    const email = body?.email;
    const trimmedEmail = typeof email === "string" ? email.trim() : "";

    if (!trimmedEmail) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Email is required",
            400,
            { field: "email" },
        );
    }

    const { token, apiBase } = await plaudSendCode(trimmedEmail);

    return NextResponse.json({
        success: true,
        otpToken: token,
        apiBase,
    });
});
