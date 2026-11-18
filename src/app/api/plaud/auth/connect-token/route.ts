import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    buildPlaudTokenSet,
    decodeAccessTokenExpiry,
    decodeJwtClaims,
    fetchPlaudUserMeEmail,
    isPlaudWorkspaceToken,
} from "@/lib/plaud/auth";
import { DEFAULT_PLAUD_API_BASE } from "@/lib/plaud/client";
import { persistPlaudConnection } from "@/lib/plaud/persist-connection";
import { isValidPlaudApiUrl } from "@/lib/plaud/servers";

const MAX_REFRESH_TOKEN_LENGTH = 8192;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const SHORT_LIVED_TOKEN_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_SESSION_MS = 31 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const REFRESH_TOKEN_DROPPED_WARNING =
    "Riffado couldn't use the refresh token it received, so this connection won't renew automatically.";

interface ParsedRefreshToken {
    refreshToken: string | null;
    warning?: string;
}

function droppedRefreshToken(): ParsedRefreshToken {
    return { refreshToken: null, warning: REFRESH_TOKEN_DROPPED_WARNING };
}

function parseRefreshToken(
    raw: unknown,
    accessToken: string,
): ParsedRefreshToken {
    if (raw === undefined || raw === null) return { refreshToken: null };
    if (typeof raw !== "string") return droppedRefreshToken();
    const token = raw.trim().replace(/^Bearer\s+/i, "");
    if (!token) return { refreshToken: null };
    const claims =
        token.length <= MAX_REFRESH_TOKEN_LENGTH && JWT_SHAPE.test(token)
            ? decodeJwtClaims(token)
            : null;
    if (!claims || isPlaudWorkspaceToken(token)) return droppedRefreshToken();

    const refreshSub = typeof claims.sub === "string" ? claims.sub : "";
    const accessSub = decodeJwtClaims(accessToken)?.sub;
    if (!refreshSub || typeof accessSub !== "string" || !accessSub) {
        return droppedRefreshToken();
    }
    if (refreshSub !== accessSub) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "The refresh token belongs to a different Plaud account than the access token. Sign in to Plaud again and reconnect.",
            400,
            { field: "refreshToken" },
        );
    }

    const exp = decodeAccessTokenExpiry(token);
    if (exp && exp.getTime() <= Date.now()) return droppedRefreshToken();
    return { refreshToken: token };
}

function capSessionEnd(sessionExpiresAt: Date | null): Date {
    const cap = new Date(Date.now() + MAX_SESSION_MS);
    return sessionExpiresAt && sessionExpiresAt < cap ? sessionExpiresAt : cap;
}

function shortLivedTokenWarning(
    accessExpiresAt: Date | null,
    method: "connector" | "paste" | "unknown",
): string | undefined {
    if (!accessExpiresAt) return undefined;
    const remaining = accessExpiresAt.getTime() - Date.now();
    if (remaining >= SHORT_LIVED_TOKEN_MS) return undefined;
    const hours = Math.max(1, Math.ceil(remaining / HOUR_MS));
    const duration = `${hours} hour${hours === 1 ? "" : "s"}`;
    if (method === "connector") {
        return `This sign-in expires in ${duration}. Riffado Connector 0.2.4 or newer keeps you connected for up to 30 days; older versions connect for about a day. Plaud accounts that sign in with email and password can also use the email code, which lasts 30 days.`;
    }
    return `This token expires in ${duration}. Sign in with Plaud keeps you connected for up to 30 days with Riffado Connector 0.2.4 or newer. Plaud accounts that sign in with email and password can also use the email code, which lasts 30 days. Google and Apple accounts can't use the email code.`;
}

/**
 * POST /api/plaud/auth/connect-token
 *
 * Connect a Plaud account by submitting an existing user token, bypassing
 * the OTP flow. This exists because Plaud's OTP login signs you into an
 * email-only account that is *separate* from any Google/Apple-linked account
 * sharing the same email address (issue #65) -- if you originally signed up
 * for Plaud via Google or Apple, the OTP flow returns a token for an empty
 * shadow account and your real recordings never appear.
 *
 * Body: `accessToken` (required), optional `refreshToken`, `apiBase` and
 * `source` (`connector` | `paste`). Riffado Connector 0.2.4 and newer send
 * the Plaud web session's `pld_ut` and `pld_urt` cookies as `accessToken`
 * and `refreshToken`; older connector versions and manual paste send
 * `pld_ut` only. With a refresh token, Riffado renews the 24-hour user
 * token until the 30-day sign-in ends. Without one, the connection ends when
 * the user token expires; a token expiring within two days still connects
 * but the response carries a `warning` the UI shows.
 *
 * A `refreshToken` whose `sub` differs from the access token's is rejected
 * with 400. One that is malformed, expired, or where either token lacks
 * `sub` is dropped and reported in `warning`. The stored session end is
 * capped at 31 days from now whatever the refresh token's `exp` claims.
 *
 * Source: https://github.com/riffado/riffado/blob/main/src/app/api/plaud/auth/connect-token/route.ts
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const body = (await request.json().catch(() => null)) as {
        accessToken?: unknown;
        refreshToken?: unknown;
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
            "That doesn't look like a Plaud access token. Copy the value of the pld_ut cookie from web.plaud.ai.",
            400,
            { field: "accessToken" },
        );
    }

    // Reject a workspace token (WT). web.plaud.ai uses the short-lived (~24h)
    // WT on the data requests users inspect (/device/list, /file/simple/web),
    // so SSO users paste it by mistake. A WT validates against /device/list
    // (so the connect would *appear* to succeed) but cannot mint a fresh WT,
    // so the connection dies within a day. Catch it here with actionable copy
    // instead of letting it rot. (issue #203)
    if (isPlaudWorkspaceToken(accessToken)) {
        throw new AppError(
            ErrorCode.PLAUD_WORKSPACE_TOKEN_PASTED,
            "That's a workspace token, which stops working within a day and can't be renewed. Use Sign in with Plaud or the email code instead. To paste manually, copy the pld_ut cookie from web.plaud.ai (DevTools → Application → Cookies), not the Authorization header from a /device/list request.",
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

    const { refreshToken, warning: refreshTokenWarning } = parseRefreshToken(
        body.refreshToken,
        accessToken,
    );

    // SSRF guard: apiBase is user-supplied. Restrict to plaud.ai / plaud.cn hosts.
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

    const rawSource = typeof body.source === "string" ? body.source : "unknown";
    const method =
        rawSource === "connector" || rawSource === "paste"
            ? rawSource
            : "unknown";
    // Deliberately omit `plaudEmail` from the log line — it's PII and
    // not needed for diagnosing connect failures (source + apiBase
    // already disambiguate the path).
    console.log(
        `[plaud/connect-token] persisting connection (source=${rawSource}, apiBase=${apiBaseRaw}, refreshToken=${refreshToken ? "yes" : "no"})`,
    );

    const tokenSet = buildPlaudTokenSet({ accessToken, refreshToken });
    const tokens = tokenSet.refreshToken
        ? {
              ...tokenSet,
              sessionExpiresAt: capSessionEnd(tokenSet.sessionExpiresAt),
          }
        : tokenSet;

    const { devices } = await persistPlaudConnection({
        userId: session.user.id,
        tokens,
        apiBase: apiBaseRaw,
        plaudEmail,
        method,
    });

    const warning = [
        refreshTokenWarning,
        tokens.refreshToken
            ? undefined
            : shortLivedTokenWarning(tokens.accessExpiresAt, method),
    ]
        .filter(Boolean)
        .join(" ");

    return NextResponse.json({
        success: true,
        devices,
        ...(warning ? { warning } : {}),
    });
});
