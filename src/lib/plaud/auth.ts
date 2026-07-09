import { AppError, ErrorCode } from "@/lib/errors";
import { DEFAULT_PLAUD_API_BASE } from "./client";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { PLAUD_USER_AGENT } from "./servers";

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

export interface PlaudOtpLoginResponse {
    status: number;
    msg: string;
    access_token?: string;
    data?: {
        access_token?: string;
    };
}

const MAX_REGION_REDIRECTS = 3;

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

/** Verify the OTP code and obtain the access token. */
export async function plaudVerifyOtp(
    code: string,
    otpToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
): Promise<{
    accessToken: string;
}> {
    const res = await plaudFetch(`${apiBase}/auth/otp-login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": PLAUD_USER_AGENT,
        },
        body: JSON.stringify({ code, token: otpToken }),
    });

    const body = await safeParseJson<PlaudOtpLoginResponse>(res);

    const accessToken =
        body.access_token ?? body.data?.access_token ?? undefined;

    if (!accessToken) {
        throw new AppError(
            ErrorCode.PLAUD_OTP_INVALID,
            body.msg || "Invalid verification code",
            400,
            { plaudStatus: body.status },
        );
    }

    return { accessToken };
}

/**
 * Claims we read off a Plaud JWT. Plaud signs both long-lived user tokens
 * (UT) and short-lived workspace tokens (WT) with the same alg; the claim
 * set is what tells them apart. WTs carry `ut_ref`/`wid`/`wtype`; UTs don't.
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

/** Decode the JWT `exp` claim without verifying. UX hint only — never authorise from this. */
export function decodeAccessTokenExpiry(token: string): Date | null {
    const claims = decodeJwtClaims(token);
    if (!claims) return null;
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
        return null;
    }
    return new Date(claims.exp * 1000);
}

/**
 * True if `token` is a Plaud workspace token (WT) rather than a user token
 * (UT). WTs are workspace-scoped (`ut_ref`/`wid` claims) and short-lived
 * (~24h). Riffado must store the long-lived UT: minting a fresh WT requires
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
