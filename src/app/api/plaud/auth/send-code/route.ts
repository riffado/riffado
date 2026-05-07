import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { email } = await request.json();

    if (!email || typeof email !== "string") {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Email is required",
            400,
            { field: "email" },
        );
    }

    const { token, apiBase } = await plaudSendCode(email.trim());

    return NextResponse.json({
        success: true,
        otpToken: token,
        apiBase,
    });
});
