/**
 * "Sign in with ChatGPT" OAuth helpers: PKCE, authorize URL shape,
 * paste-back parsing, token endpoint errors and ID token validation.
 */

import {
    createHash,
    generateKeyPairSync,
    type KeyObject,
    sign,
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    assertPlanUsageGranted,
    buildAuthorizeUrl,
    CHATGPT_REDIRECT_URI,
    ChatGptOAuthError,
    DYNAMIC_CLIENT_ID,
    exchangeAuthorizationCode,
    generatePkce,
    isReauthRequiredError,
    parseCallbackUrl,
    refreshAccessToken,
    resetJwksCache,
    revokeRefreshToken,
    verifyIdToken,
} from "@/lib/ai/chatgpt/oauth";

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resetJwksCache();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("generatePkce", () => {
    it("derives an S256 challenge from the verifier", () => {
        const { verifier, challenge } = generatePkce();
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(challenge).toBe(
            createHash("sha256").update(verifier).digest("base64url"),
        );
    });
});

describe("buildAuthorizeUrl", () => {
    const base = {
        hostId: "urn:uuid:host",
        state: "st",
        nonce: "no",
        codeChallenge: "ch",
    };

    it("uses dynamic registration with an agent name on first sign-in", () => {
        const url = new URL(buildAuthorizeUrl(base));
        expect(url.origin + url.pathname).toBe(
            "https://auth.openai.com/api/accounts/authorize",
        );
        expect(url.searchParams.get("client_id")).toBe(DYNAMIC_CLIENT_ID);
        expect(url.searchParams.get("agent_name_hint")).toBe("Riffado");
        expect(url.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:host");
        expect(url.searchParams.get("redirect_uri")).toBe(CHATGPT_REDIRECT_URI);
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("resource")).toBe(
            "https://api.openai.com/v1",
        );
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("scope")?.split(" ")).toEqual(
            expect.arrayContaining([
                "openid",
                "offline_access",
                "resource.invoke",
                "chatgpt.tokens.use.direct",
            ]),
        );
    });

    it("reuses the issued client id and omits agent_name_hint on re-auth", () => {
        const url = new URL(
            buildAuthorizeUrl({
                ...base,
                clientId: "oaiapp_123",
                idTokenHint: "old.id.token",
                loginHint: "me@example.com",
            }),
        );
        expect(url.searchParams.get("client_id")).toBe("oaiapp_123");
        expect(url.searchParams.has("agent_name_hint")).toBe(false);
        expect(url.searchParams.get("id_token_hint")).toBe("old.id.token");
        expect(url.searchParams.get("login_hint")).toBe("me@example.com");
    });
});

describe("parseCallbackUrl", () => {
    it("extracts code, state and the issued client id", () => {
        const result = parseCallbackUrl(
            "http://127.0.0.1:1455/auth/callback?code=abc&state=xyz&client_id=oaiapp_1&scope=openid",
        );
        expect(result).toEqual({
            ok: true,
            code: "abc",
            state: "xyz",
            clientId: "oaiapp_1",
        });
    });

    it("accepts another loopback port and surrounding whitespace", () => {
        const result = parseCallbackUrl(
            "  http://127.0.0.1:54321/auth/callback?code=a&state=b \n",
        );
        expect(result).toMatchObject({ ok: true, code: "a", clientId: null });
    });

    it("accepts a bare query string", () => {
        expect(parseCallbackUrl("?code=a&state=b")).toMatchObject({
            ok: true,
            code: "a",
            state: "b",
        });
    });

    it("rejects a non-loopback URL", () => {
        const result = parseCallbackUrl(
            "https://evil.example/auth/callback?code=a&state=b",
        );
        expect(result.ok).toBe(false);
    });

    it("rejects a wrong path", () => {
        expect(
            parseCallbackUrl("http://127.0.0.1:1455/other?code=a&state=b").ok,
        ).toBe(false);
    });

    it("surfaces an OAuth error the user hit", () => {
        const result = parseCallbackUrl(
            "http://127.0.0.1:1455/auth/callback?error=access_denied&error_description=User%20declined",
        );
        expect(result).toEqual({
            ok: false,
            message: "ChatGPT sign-in failed: User declined",
        });
    });

    it("rejects a URL without code or state", () => {
        expect(
            parseCallbackUrl("http://127.0.0.1:1455/auth/callback?state=b").ok,
        ).toBe(false);
        expect(parseCallbackUrl("not a url").ok).toBe(false);
        expect(parseCallbackUrl("").ok).toBe(false);
    });
});

describe("token endpoint", () => {
    it("posts a form-encoded authorization_code grant with the issued client id", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ access_token: "at", refresh_token: "rt" }),
        );
        await exchangeAuthorizationCode({
            clientId: "oaiapp_1",
            code: "c",
            codeVerifier: "v",
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://auth.openai.com/api/accounts/oauth/token");
        const body = new URLSearchParams(init.body);
        expect(Object.fromEntries(body)).toEqual({
            grant_type: "authorization_code",
            client_id: "oaiapp_1",
            code: "c",
            code_verifier: "v",
            redirect_uri: CHATGPT_REDIRECT_URI,
            resource: "https://api.openai.com/v1",
        });
    });

    it("flags rotated-out refresh tokens as needing re-auth", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ error: "refresh_token_reused" }, 400),
        );
        const error = await refreshAccessToken({
            clientId: "oaiapp_1",
            refreshToken: "rt",
        }).catch((e) => e);
        expect(error).toBeInstanceOf(ChatGptOAuthError);
        expect(isReauthRequiredError(error)).toBe(true);
    });

    it("doesn't treat client misconfiguration as re-auth", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ error: "invalid_client" }, 401),
        );
        const error = await refreshAccessToken({
            clientId: "x",
            refreshToken: "rt",
        }).catch((e) => e);
        expect(isReauthRequiredError(error)).toBe(false);
    });
});

describe("revokeRefreshToken", () => {
    it("reports success only when OpenAI confirms", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        await expect(
            revokeRefreshToken({ clientId: "c", refreshToken: "rt" }),
        ).resolves.toBe(true);

        fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
        await expect(
            revokeRefreshToken({ clientId: "c", refreshToken: "rt" }),
        ).resolves.toBe(false);

        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        await expect(
            revokeRefreshToken({ clientId: "c", refreshToken: "rt" }),
        ).resolves.toBe(false);
    });
});

describe("assertPlanUsageGranted", () => {
    it("passes when plan-usage scopes were granted", () => {
        expect(() =>
            assertPlanUsageGranted(
                "openid email resource.invoke chatgpt.tokens.use.direct",
            ),
        ).not.toThrow();
    });

    it("throws when the user didn't grant plan usage", () => {
        expect(() => assertPlanUsageGranted("openid email profile")).toThrow(
            ChatGptOAuthError,
        );
        expect(() => assertPlanUsageGranted(undefined)).toThrow();
    });
});

describe("verifyIdToken", () => {
    let privateKey: KeyObject;
    let jwk: Record<string, unknown>;

    beforeEach(() => {
        const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
        privateKey = pair.privateKey;
        jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1" };
    });

    function makeToken(
        claims: Record<string, unknown>,
        header: Record<string, unknown> = { alg: "RS256", kid: "k1" },
    ): string {
        const enc = (o: unknown) =>
            Buffer.from(JSON.stringify(o)).toString("base64url");
        const data = `${enc(header)}.${enc(claims)}`;
        const signature = sign("RSA-SHA256", Buffer.from(data), privateKey);
        return `${data}.${signature.toString("base64url")}`;
    }

    const now = () => Math.floor(Date.now() / 1000);
    const goodClaims = () => ({
        iss: "https://auth.openai.com",
        aud: "oaiapp_1",
        sub: "user-sub",
        email: "me@example.com",
        nonce: "n1",
        exp: now() + 3600,
    });

    function serveJwks() {
        fetchMock.mockImplementation(async () => jsonResponse({ keys: [jwk] }));
    }

    it("accepts a valid token and returns subject + email", async () => {
        serveJwks();
        const claims = await verifyIdToken(makeToken(goodClaims()), {
            clientId: "oaiapp_1",
            nonce: "n1",
        });
        expect(claims).toEqual({ sub: "user-sub", email: "me@example.com" });
    });

    it("accepts an audience array containing the client id", async () => {
        serveJwks();
        await expect(
            verifyIdToken(
                makeToken({ ...goodClaims(), aud: ["other", "oaiapp_1"] }),
                { clientId: "oaiapp_1", nonce: "n1" },
            ),
        ).resolves.toMatchObject({ sub: "user-sub" });
    });

    it.each([
        ["nonce", { nonce: "other" }],
        ["audience", { aud: "someone-else" }],
        ["issuer", { iss: "https://evil.example" }],
        ["expiry", { exp: now() - 3600 }],
    ])("rejects a bad %s", async (_name, override) => {
        serveJwks();
        await expect(
            verifyIdToken(makeToken({ ...goodClaims(), ...override }), {
                clientId: "oaiapp_1",
                nonce: "n1",
            }),
        ).rejects.toBeInstanceOf(ChatGptOAuthError);
    });

    it("rejects a token signed by a different key", async () => {
        serveJwks();
        const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const token = makeToken(goodClaims());
        const [h, p] = token.split(".");
        const forged = sign(
            "RSA-SHA256",
            Buffer.from(`${h}.${p}`),
            other.privateKey,
        ).toString("base64url");
        await expect(
            verifyIdToken(`${h}.${p}.${forged}`, {
                clientId: "oaiapp_1",
                nonce: "n1",
            }),
        ).rejects.toThrow("signature");
    });

    it("rejects alg=none", async () => {
        serveJwks();
        await expect(
            verifyIdToken(makeToken(goodClaims(), { alg: "none" }), {
                clientId: "oaiapp_1",
                nonce: "n1",
            }),
        ).rejects.toBeInstanceOf(ChatGptOAuthError);
    });

    it("refetches the JWKS once when the key id is unknown (rotation)", async () => {
        // The cached keyset only has an older key under another kid, so
        // kid matching must reject it and refetch.
        const oldKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const oldJwk = {
            ...oldKey.publicKey.export({ format: "jwk" }),
            kid: "k0",
        };
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ keys: [oldJwk] }))
            .mockResolvedValueOnce(jsonResponse({ keys: [oldJwk, jwk] }));
        await expect(
            verifyIdToken(makeToken(goodClaims()), {
                clientId: "oaiapp_1",
                nonce: "n1",
            }),
        ).resolves.toMatchObject({ sub: "user-sub" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects a token whose kid matches no published key", async () => {
        const oldKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const oldJwk = {
            ...oldKey.publicKey.export({ format: "jwk" }),
            kid: "k0",
        };
        fetchMock.mockImplementation(async () =>
            jsonResponse({ keys: [oldJwk] }),
        );
        await expect(
            verifyIdToken(makeToken(goodClaims()), {
                clientId: "oaiapp_1",
                nonce: "n1",
            }),
        ).rejects.toThrow("signing key not found");
    });
});
