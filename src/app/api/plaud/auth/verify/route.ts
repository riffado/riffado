import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { plaudVerifyOtp } from "@/lib/plaud/auth";
import { persistPlaudConnection } from "@/lib/plaud/persist-connection";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";

/**
 * POST /api/plaud/auth/verify
 *
 * Verifies the OTP code against Plaud's API, obtains a long-lived access
 * token, encrypts it, and stores the connection.
 *
 * Errors are unified via `apiHandler` — Plaud helpers throw structured
 * `AppError`s, so a Plaud 5xx after retries surfaces as 502
 * `PLAUD_UPSTREAM_ERROR` (not 400 "fix your token"), and a Plaud 4xx
 * surfaces as 400 `PLAUD_API_ERROR` / `PLAUD_OTP_INVALID` with the
 * upstream `msg` preserved.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/verify/route.ts
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { code, otpToken, apiBase, email } = await request.json();

    if (
        typeof code !== "string" ||
        typeof otpToken !== "string" ||
        typeof apiBase !== "string" ||
        !code ||
        !otpToken ||
        !apiBase
    ) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Code, OTP token, and API base are required",
            400,
        );
    }

    // SSRF guard: the client sends apiBase back to us (originally obtained
    // via the regional -302 redirect in send-code). Restrict to plaud.ai
    // hosts so a tampered client cannot point the server at an arbitrary
    // URL and coerce it into an internal-network request.
    if (!isValidPlaudApiUrl(apiBase)) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_API_BASE,
            "Invalid API base",
            400,
        );
    }

    const plaudEmail =
        typeof email === "string" && email.trim().length > 0
            ? email.trim().toLowerCase()
            : null;

    // Verify OTP with Plaud → get the (long-lived) user token (UT)
    const { accessToken } = await plaudVerifyOtp(code, otpToken, apiBase);

    // Hand off to the shared persistence path: workspace discovery,
    // end-to-end /device/list validation, encrypted upsert, device sync.
    // Same gauntlet the paste-token connect flow runs through.
    const { devices } = await persistPlaudConnection({
        userId: session.user.id,
        accessToken,
        apiBase,
        plaudEmail,
    });

    return NextResponse.json({
        success: true,
        devices,
    });
});
