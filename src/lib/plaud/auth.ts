import { AppError, ErrorCode } from "@/lib/errors";
import { DEFAULT_PLAUD_API_BASE } from "./client";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { isValidPlaudApiUrl, PLAUD_USER_AGENT } from "./servers";

export interface PlaudSendCodeResponse {
    status: number;
    msg: string;
    token?: string;
    data?: {
        domains?: {
            api?: string;
        };
    };
}

interface PlaudUserTokenFields {
    access_token?: string;
    refresh_token?: string;
    /** Unix seconds. */
    ut_expire_at?: number;
    /** Unix seconds. */
    urt_expire_at?: number;
}

export interface PlaudOtpLoginResponse extends PlaudUserTokenFields {
    status: number;
    msg: string;
    data?: PlaudUserTokenFields;
}

/** Body of `POST /auth/refresh-user-token`. Same token fields as OTP login. */
export interface PlaudRefreshUserTokenResponse extends PlaudUserTokenFields {
    status?: number;
    msg?: string;
    data?: PlaudUserTokenFields;
}

/**
 * A Plaud user token (UT) with its optional refresh token and expiries.
 * `sessionExpiresAt` is when the sign-in ends for good: refreshing never
 * extends past it.
 */
export interface PlaudTokenSet {
    accessToken: string;
    refreshToken: string | null;
    accessExpiresAt: Date | null;
    sessionExpiresAt: Date | null;
}

const MAX_REGION_REDIRECTS = 3;

function unixSecondsToDate(value: unknown): Date | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return new Date(value * 1000);
}

/**
 * Build a token set, preferring Plaud's explicit `ut_expire_at` /
 * `urt_expire_at` (unix seconds) and falling back to each JWT's `exp`.
 * Without a refresh token the session ends when the access token does.
 */
export function buildPlaudTokenSet(input: {
    accessToken: string;
    refreshToken?: string | null;
    accessExpireAt?: unknown;
    refreshExpireAt?: unknown;
}): PlaudTokenSet {
    const refreshToken = input.refreshToken || null;
    const accessExpiresAt =
        unixSecondsToDate(input.accessExpireAt) ??
        decodeAccessTokenExpiry(input.accessToken);
    const sessionExpiresAt = refreshToken
        ? (unixSecondsToDate(input.refreshExpireAt) ??
          decodeAccessTokenExpiry(refreshToken))
        : accessExpiresAt;
    return {
        accessToken: input.accessToken,
        refreshToken,
        accessExpiresAt,
        sessionExpiresAt,
    };
}

function tokenSetFromBody(
    body: PlaudRefreshUserTokenResponse,
    fallbackRefreshToken: string | null,
): PlaudTokenSet | null {
    const accessToken = body.access_token ?? body.data?.access_token;
    if (!accessToken) return null;
    return buildPlaudTokenSet({
        accessToken,
        refreshToken:
            body.refresh_token ??
            body.data?.refresh_token ??
            fallbackRefreshToken,
        accessExpireAt: body.ut_expire_at ?? body.data?.ut_expire_at,
        refreshExpireAt: body.urt_expire_at ?? body.data?.urt_expire_at,
    });
}

/** Send an OTP code. Follows regional redirects (`status === -302`). */
export async function plaudSendCode(
    email: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
    _redirectCount = 0,
): Promise<{
    token: string;
    apiBase: string;
}> {
    const res = await plaudFetch(`${apiBase}/auth/otp-send-code`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": PLAUD_USER_AGENT,
        },
        body: JSON.stringify({ username: email }),
    });

    const body = await safeParseJson<PlaudSendCodeResponse>(res);

    if (body.status === -302 && body.data?.domains?.api) {
        if (_redirectCount >= MAX_REGION_REDIRECTS) {
            throw new AppError(
                ErrorCode.PLAUD_REGION_REDIRECT_LOOP,
                "Too many region redirects from Plaud. Please try again later.",
                502,
            );
        }
        const regionalBase = body.data.domains.api.replace(/\/+$/, "");
        return plaudSendCode(email, regionalBase, _redirectCount + 1);
    }

    if (body.status !== 0 || !body.token) {
        throw new AppError(
            ErrorCode.PLAUD_API_ERROR,
            body.msg || "Failed to send verification code",
            400,
            { plaudStatus: body.status },
        );
    }

    return { token: body.token, apiBase };
}

/** Verify the OTP code and obtain the user token, refresh token and expiries. */
export async function plaudVerifyOtp(
    code: string,
    otpToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
): Promise<PlaudTokenSet> {
    const res = await plaudFetch(`${apiBase}/auth/otp-login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": PLAUD_USER_AGENT,
        },
        body: JSON.stringify({ code, token: otpToken }),
    });

    const body = await safeParseJson<PlaudOtpLoginResponse>(res);

    const tokens = tokenSetFromBody(body, null);
    if (!tokens) {
        throw new AppError(
            ErrorCode.PLAUD_OTP_INVALID,
            body.msg || "Invalid verification code",
            400,
            { plaudStatus: body.status },
        );
    }

    return tokens;
}

const REFRESH_REJECTED_MESSAGE =
    "Plaud ended this sign-in. Reconnect your Plaud account.";

/**
 * Exchange a refresh token for a fresh user token
 * (`POST /auth/refresh-user-token`). Plaud rotates the refresh token but
 * keeps the old one valid, and never extends the session past its original
 * end. Throws `PLAUD_INVALID_TOKEN` when Plaud rejects the refresh token,
 * `PLAUD_RATE_LIMITED` / `PLAUD_UPSTREAM_ERROR` for transient failures
 * (including network errors).
 */
export async function plaudRefreshUserToken(
    refreshToken: string,
    apiBase: string,
): Promise<PlaudTokenSet> {
    if (!isValidPlaudApiUrl(apiBase)) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_API_BASE,
            "Invalid Plaud API base",
            400,
        );
    }

    let res: Response;
    try {
        res = await plaudFetch(`${apiBase}/auth/refresh-user-token`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${refreshToken}`,
                "User-Agent": PLAUD_USER_AGENT,
            },
        });
    } catch {
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Failed to communicate with Plaud. Please try again later.",
            502,
        );
    }

    if (res.status === 429) {
        throw new AppError(
            ErrorCode.PLAUD_RATE_LIMITED,
            "Too many requests to Plaud. Please try again later.",
            429,
            { plaudStatus: res.status },
        );
    }
    if (res.status >= 500) {
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud is temporarily unavailable. Please try again later.",
            502,
            { plaudStatus: res.status },
        );
    }
    if (!res.ok) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            REFRESH_REJECTED_MESSAGE,
            401,
            { plaudStatus: res.status },
        );
    }

    const body = await safeParseJson<PlaudRefreshUserTokenResponse>(res);
    const tokens =
        body.status === undefined || body.status === 0
            ? tokenSetFromBody(body, refreshToken)
            : null;
    if (!tokens) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            REFRESH_REJECTED_MESSAGE,
            401,
            { plaudStatus: body.status },
        );
    }
    return tokens;
}

/**
 * Claims we read off a Plaud JWT. Plaud signs user tokens (UT), refresh
 * tokens and workspace tokens (WT) with the same alg; the claim set is what
 * tells a WT apart. WTs carry `ut_ref`/`wid`/`wtype`; UTs don't.
 */
export interface PlaudTokenClaims {
    exp?: number;
    iat?: number;
    sub?: string;
    /** Reference to the originating user token. Present on WTs only. */
    ut_ref?: string;
    /** Workspace id the token is scoped to. Present on WTs only. */
    wid?: string;
    /** Workspace type. Present on WTs only. */
    wtype?: string;
    [key: string]: unknown;
}

/** Decode JWT claims without verifying. UX/diagnostic hint only — never authorise from this. */
export function decodeJwtClaims(token: string): PlaudTokenClaims | null {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const b64 =
            parts[1].replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (parts[1].length % 4)) % 4);
        const json =
            typeof atob === "function"
                ? atob(b64)
                : Buffer.from(b64, "base64").toString("utf8");
        const payload = JSON.parse(json) as unknown;
        if (typeof payload !== "object" || payload === null) return null;
        return payload as PlaudTokenClaims;
    } catch {
        return null;
    }
}

/**
 * Decode a JWT's `exp` claim (user or refresh token) without verifying.
 * Returns null for malformed tokens or a missing, non-numeric or
 * non-positive `exp`. Used for expiry bookkeeping only; never authorise
 * from this.
 */
export function decodeAccessTokenExpiry(token: string): Date | null {
    const claims = decodeJwtClaims(token);
    if (!claims) return null;
    return unixSecondsToDate(claims.exp);
}

/**
 * True if `token` is a Plaud workspace token (WT) rather than a user token
 * (UT). WTs are workspace-scoped (`ut_ref`/`wid` claims) and short-lived
 * (~24h). Riffado must store the UT: minting a fresh WT requires
 * a UT, so a connection built on a pasted WT cannot be refreshed and dies
 * within a day. web.plaud.ai puts the WT on the data requests users tend to
 * inspect (`/device/list`, `/file/simple/web`), which is why users paste it
 * by mistake — hence this guard. (issue #203)
 */
export function isPlaudWorkspaceToken(token: string): boolean {
    const claims = decodeJwtClaims(token);
    if (!claims) return false;
    return typeof claims.ut_ref === "string" || typeof claims.wid === "string";
}

/** Best-effort `/user/me` email lookup. Caller must pre-validate `apiBase`. */
export async function fetchPlaudUserMeEmail(
    accessToken: string,
    apiBase: string,
): Promise<string | null> {
    try {
        const res = await plaudFetch(`${apiBase}/user/me`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": PLAUD_USER_AGENT,
            },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            status?: number;
            data?: { email?: unknown };
            email?: unknown;
        };
        const raw =
            (typeof body.email === "string" && body.email) ||
            (typeof body.data?.email === "string" && body.data.email) ||
            null;
        if (!raw) return null;
        return raw.trim().toLowerCase() || null;
    } catch {
        return null;
    }
}
