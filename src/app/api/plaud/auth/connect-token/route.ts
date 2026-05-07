import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    decodeAccessTokenExpiry,
    fetchPlaudUserMeEmail,
} from "@/lib/plaud/auth";
import { DEFAULT_PLAUD_API_BASE } from "@/lib/plaud/client";
import { persistPlaudConnection } from "@/lib/plaud/persist-connection";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";

/**
 * POST /api/plaud/auth/connect-token
 *
 * Connect a Plaud account by submitting an existing access token, bypassing
 * the OTP flow. This exists because Plaud's OTP login signs you into an
 * email-only account that is *separate* from any Google/Apple-linked account
 * sharing the same email address (issue #65) -- if you originally signed up
 * for Plaud via Google or Apple, the OTP flow returns a token for an empty
 * shadow account and your real recordings never appear.
 *
 * The user pastes the bearer token they grab from a logged-in `web.plaud.ai`
 * session (devtools → Network → Authorization header on any /api*.plaud.ai
 * request, minus the "Bearer " prefix). We decode `exp` for a UX hint, run
 * the same workspace + /device/list validation as the OTP path, and store.
 *
 * Source: https://github.com/openplaud/openplaud/blob/main/src/app/api/plaud/auth/connect-token/route.ts
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const body = (await request.json().catch(() => null)) as {
        accessToken?: unknown;
        apiBase?: unknown;
        source?: unknown;
    } | null;

    if (!body || typeof body.accessToken !== "string") {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "accessToken is required",
            400,
            { field: "accessToken" },
        );
    }

    const accessToken = body.accessToken.trim().replace(/^Bearer\s+/i, "");
    if (!accessToken) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "accessToken is required",
            400,
            { field: "accessToken" },
        );
    }

    // Cheap shape check: Plaud user tokens are JWTs (3 base64url segments).
    // Catches accidentally-pasted nonsense before we round-trip Plaud.
    if (accessToken.split(".").length !== 3) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "That doesn't look like a Plaud access token. Copy the value of the Authorization header on a request to api*.plaud.ai (without the leading 'Bearer ').",
            400,
            { field: "accessToken" },
        );
    }

    // UX-only `exp` check. We don't trust the decoded payload for any
    // security decision — Plaud is the verifier on /device/list below.
    // If `exp` is in the past we still bail, since /device/list will
    // 401 and the resulting message is less useful than this one.
    const exp = decodeAccessTokenExpiry(accessToken);
    if (exp && exp.getTime() < Date.now()) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            "This Plaud access token has already expired. Sign in to web.plaud.ai again and copy a fresh one.",
            400,
        );
    }

    // SSRF guard: apiBase is user-supplied. Restrict to plaud.ai hosts.
    // Default to global if the client didn't pick a region; the paste
    // flow has no -302 redirect path so the user picks via a region
    // selector in the UI.
    const apiBaseRaw =
        typeof body.apiBase === "string" && body.apiBase.trim().length > 0
            ? body.apiBase.trim().replace(/\/+$/, "")
            : DEFAULT_PLAUD_API_BASE;

    if (!isValidPlaudApiUrl(apiBaseRaw)) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_API_BASE,
            "Invalid API base",
            400,
        );
    }

    // Best-effort email enrichment. Failure is non-fatal —
    // plaud_connections.plaud_email is nullable.
    const plaudEmail = await fetchPlaudUserMeEmail(accessToken, apiBaseRaw);

    const source = typeof body.source === "string" ? body.source : "unknown";
    // Deliberately omit `plaudEmail` from the log line — it's PII and
    // not needed for diagnosing connect failures (source + apiBase
    // already disambiguate the path).
    console.log(
        `[plaud/connect-token] persisting connection (source=${source}, apiBase=${apiBaseRaw})`,
    );

    const { devices } = await persistPlaudConnection({
        userId: session.user.id,
        accessToken,
        apiBase: apiBaseRaw,
        plaudEmail,
    });

    return NextResponse.json({
        success: true,
        devices,
    });
});
