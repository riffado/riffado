/**
 * "Sign in with ChatGPT" OAuth client for ChatGPT plan usage.
 *
 * Implements the open-source flow documented at
 * https://developers.openai.com/siwc/token-sharing-open-source :
 * authorization code + PKCE (S256) with dynamic client registration.
 *
 * OpenAI only accepts an HTTP loopback redirect on 127.0.0.1. A
 * self-hosted Riffado usually runs on a different machine than the
 * browser (a NAS, a homelab box), so the redirect can't reach the
 * server. We use a paste-back flow instead: the browser lands on the
 * (unreachable) loopback URL, the user copies that URL into Riffado,
 * and the server finishes the exchange with the PKCE verifier it kept.
 *
 * Every function here is pure or talks only to auth.openai.com; storage
 * lives in `credentials.ts`.
 */

import {
    createHash,
    createPublicKey,
    randomBytes,
    randomUUID,
    verify as verifySignature,
} from "node:crypto";

export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_AUTHORIZE_URL =
    "https://auth.openai.com/api/accounts/authorize";
export const CHATGPT_TOKEN_URL =
    "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_REVOKE_URL =
    "https://auth.openai.com/api/accounts/oauth/revoke";
export const CHATGPT_JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";

/** Client id used for the first sign-in; OpenAI then issues a real one. */
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";

/** Scheme, host and path are fixed by OpenAI; only the port may vary. */
export const CHATGPT_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";

/** Sent as `agent_name_hint` on first registration. */
export const CHATGPT_AGENT_NAME = "Riffado";

export const CHATGPT_PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    CHATGPT_PLAN_USAGE_SCOPE,
] as const;

/** Scopes without which plan-usage inference can't work. */
const REQUIRED_GRANTED_SCOPES = ["resource.invoke", CHATGPT_PLAN_USAGE_SCOPE];

const FETCH_TIMEOUT_MS = 15_000;

function base64Url(buf: Buffer): string {
    return buf.toString("base64url");
}

export interface PkcePair {
    verifier: string;
    challenge: string;
}

export function generatePkce(): PkcePair {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
}

export function randomToken(): string {
    return base64Url(randomBytes(24));
}

/** Stable per-host identifier, RFC 4122 UUID URN as OpenAI suggests. */
export function generateHostId(): string {
    return `urn:uuid:${randomUUID()}`;
}

export interface AuthorizeUrlParams {
    /** Issued client id for a returning sign-in; omit for first registration. */
    clientId?: string | null;
    hostId: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    /** Previous ID token, sent as `id_token_hint` on re-authorization. */
    idTokenHint?: string | null;
    /** Saved email, sent as `login_hint`. */
    loginHint?: string | null;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
    const url = new URL(CHATGPT_AUTHORIZE_URL);
    const isNewRegistration = !params.clientId;
    url.searchParams.set(
        "client_id",
        isNewRegistration ? DYNAMIC_CLIENT_ID : (params.clientId as string),
    );
    if (isNewRegistration) {
        url.searchParams.set("agent_name_hint", CHATGPT_AGENT_NAME);
    }
    url.searchParams.set("ext_agent_host_id", params.hostId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", CHATGPT_REDIRECT_URI);
    url.searchParams.set("scope", CHATGPT_SCOPES.join(" "));
    url.searchParams.set("resource", CHATGPT_RESOURCE);
    url.searchParams.set("state", params.state);
    url.searchParams.set("nonce", params.nonce);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", params.codeChallenge);
    if (params.idTokenHint) {
        url.searchParams.set("id_token_hint", params.idTokenHint);
    }
    if (params.loginHint) {
        url.searchParams.set("login_hint", params.loginHint);
    }
    return url.toString();
}

export type CallbackParseResult =
    | {
          ok: true;
          code: string;
          state: string;
          /** Present on a new registration: the issued client id. */
          clientId: string | null;
      }
    | { ok: false; message: string };

/**
 * Parse the loopback URL the user pasted back. Accepts the full URL or
 * just its query string, and surfaces an OAuth `error` if the user
 * declined. Only the documented loopback origin is accepted, so a stray
 * paste of some other URL fails loudly instead of being half-parsed.
 */
export function parseCallbackUrl(input: string): CallbackParseResult {
    const trimmed = input.trim();
    if (!trimmed) {
        return { ok: false, message: "Paste the URL from your browser." };
    }

    let url: URL;
    try {
        url = trimmed.startsWith("?")
            ? new URL(`${CHATGPT_REDIRECT_URI}${trimmed}`)
            : new URL(trimmed);
    } catch {
        return {
            ok: false,
            message:
                "That doesn't look like a URL. Copy the full address from the page that failed to load.",
        };
    }

    const expected = new URL(CHATGPT_REDIRECT_URI);
    if (
        url.protocol !== expected.protocol ||
        url.hostname !== expected.hostname ||
        url.pathname !== expected.pathname
    ) {
        return {
            ok: false,
            message: `Expected a URL starting with http://127.0.0.1:<port>${expected.pathname}`,
        };
    }

    const error = url.searchParams.get("error");
    if (error) {
        const description = url.searchParams.get("error_description");
        return {
            ok: false,
            message: description
                ? `ChatGPT sign-in failed: ${description}`
                : `ChatGPT sign-in failed (${error}).`,
        };
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
        return {
            ok: false,
            message:
                "The URL is missing the sign-in code. Copy the full address, including everything after the ?.",
        };
    }

    return {
        ok: true,
        code,
        state,
        clientId: url.searchParams.get("client_id"),
    };
}

export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
    earliest_refresh_at?: number;
}

/** OAuth error from the token endpoint, carrying OpenAI's `error` code. */
export class ChatGptOAuthError extends Error {
    constructor(
        message: string,
        readonly code: string | null,
        readonly status: number,
    ) {
        super(message);
        this.name = "ChatGptOAuthError";
    }
}

/** Refresh-token failures that mean the user must sign in again. */
const REAUTH_ERROR_CODES = new Set([
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
]);

export function isReauthRequiredError(error: unknown): boolean {
    return (
        error instanceof ChatGptOAuthError &&
        error.code !== null &&
        REAUTH_ERROR_CODES.has(error.code)
    );
}

async function postTokenEndpoint(
    body: Record<string, string>,
): Promise<TokenResponse> {
    const response = await fetch(CHATGPT_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;

    if (!response.ok || !data || typeof data.access_token !== "string") {
        const code = typeof data?.error === "string" ? data.error : null;
        const description =
            typeof data?.error_description === "string"
                ? data.error_description
                : null;
        throw new ChatGptOAuthError(
            description ?? code ?? `Token request failed (${response.status})`,
            code,
            response.status,
        );
    }

    return data as unknown as TokenResponse;
}

export function exchangeAuthorizationCode(args: {
    clientId: string;
    code: string;
    codeVerifier: string;
}): Promise<TokenResponse> {
    return postTokenEndpoint({
        grant_type: "authorization_code",
        client_id: args.clientId,
        code: args.code,
        code_verifier: args.codeVerifier,
        redirect_uri: CHATGPT_REDIRECT_URI,
        resource: CHATGPT_RESOURCE,
    });
}

export function refreshAccessToken(args: {
    clientId: string;
    refreshToken: string;
}): Promise<TokenResponse> {
    return postTokenEndpoint({
        grant_type: "refresh_token",
        client_id: args.clientId,
        refresh_token: args.refreshToken,
        resource: CHATGPT_RESOURCE,
    });
}

/**
 * Revoke a refresh token at OpenAI. Never throws; returns whether OpenAI
 * confirmed the revocation (2xx) so callers can tell the user when it
 * didn't. Logs only the status, never the token.
 */
export async function revokeRefreshToken(args: {
    clientId: string;
    refreshToken: string;
}): Promise<boolean> {
    try {
        const response = await fetch(CHATGPT_REVOKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                token: args.refreshToken,
                token_type_hint: "refresh_token",
                client_id: args.clientId,
            }).toString(),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            console.warn(
                `[chatgpt] token revocation rejected (${response.status})`,
            );
            return false;
        }
        return true;
    } catch (error) {
        console.warn(
            "[chatgpt] token revocation failed",
            error instanceof Error ? error.name : "unknown error",
        );
        return false;
    }
}

/** Throws unless every scope plan usage depends on was granted. */
export function assertPlanUsageGranted(scope: string | undefined): void {
    const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
    const missing = REQUIRED_GRANTED_SCOPES.filter((s) => !granted.has(s));
    if (missing.length > 0) {
        throw new ChatGptOAuthError(
            "ChatGPT plan usage wasn't granted. Sign in again and allow Riffado to use your ChatGPT plan.",
            "insufficient_scope",
            403,
        );
    }
}

// ---- ID token validation -------------------------------------------------

export interface IdTokenClaims {
    sub: string;
    email: string | null;
}

interface Jwk {
    kid?: string;
    kty: string;
    alg?: string;
    n?: string;
    e?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(forceRefresh: boolean): Promise<Jwk[]> {
    if (
        !forceRefresh &&
        jwksCache &&
        Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
    ) {
        return jwksCache.keys;
    }
    const response = await fetch(CHATGPT_JWKS_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(
            `Failed to fetch OpenAI signing keys (${response.status})`,
        );
    }
    const data = (await response.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(data.keys) ? data.keys : [];
    jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
}

/** Test hook: drop cached signing keys. */
export function resetJwksCache(): void {
    jwksCache = null;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

const CLOCK_SKEW_SECONDS = 120;

/**
 * Validate an OpenAI ID token: RS256 signature against OpenAI's JWKS,
 * issuer, audience (the issued client id), expiry and the nonce we sent.
 */
export async function verifyIdToken(
    idToken: string,
    expected: { clientId: string; nonce: string },
): Promise<IdTokenClaims> {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
        throw new ChatGptOAuthError(
            "Malformed ID token",
            "invalid_id_token",
            400,
        );
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
        header = decodeJsonSegment(headerB64);
        payload = decodeJsonSegment(payloadB64);
    } catch {
        throw new ChatGptOAuthError(
            "Malformed ID token",
            "invalid_id_token",
            400,
        );
    }

    if (header.alg !== "RS256") {
        throw new ChatGptOAuthError(
            "Unexpected ID token algorithm",
            "invalid_id_token",
            400,
        );
    }

    const kid = typeof header.kid === "string" ? header.kid : undefined;
    const pickKey = (keys: Jwk[]) =>
        keys.find((k) => k.kty === "RSA" && (!kid || k.kid === kid));
    let jwk = pickKey(await getJwks(false));
    if (!jwk) {
        // Key rotation: refetch once before giving up.
        jwk = pickKey(await getJwks(true));
    }
    if (!jwk) {
        throw new ChatGptOAuthError(
            "ID token signing key not found",
            "invalid_id_token",
            400,
        );
    }

    const publicKey = createPublicKey({
        key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
        format: "jwk",
    });
    const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, "base64url");
    if (!verifySignature("RSA-SHA256", signedData, publicKey, signature)) {
        throw new ChatGptOAuthError(
            "ID token signature is invalid",
            "invalid_id_token",
            400,
        );
    }

    if (payload.iss !== CHATGPT_ISSUER) {
        throw new ChatGptOAuthError(
            "ID token issuer mismatch",
            "invalid_id_token",
            400,
        );
    }

    const aud = payload.aud;
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(expected.clientId)) {
        throw new ChatGptOAuthError(
            "ID token audience mismatch",
            "invalid_id_token",
            400,
        );
    }

    const now = Math.floor(Date.now() / 1000);
    if (
        typeof payload.exp !== "number" ||
        payload.exp + CLOCK_SKEW_SECONDS < now
    ) {
        throw new ChatGptOAuthError(
            "ID token has expired",
            "invalid_id_token",
            400,
        );
    }

    if (payload.nonce !== expected.nonce) {
        throw new ChatGptOAuthError(
            "ID token nonce mismatch",
            "invalid_id_token",
            400,
        );
    }

    if (typeof payload.sub !== "string" || !payload.sub) {
        throw new ChatGptOAuthError(
            "ID token has no subject",
            "invalid_id_token",
            400,
        );
    }

    return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : null,
    };
}
