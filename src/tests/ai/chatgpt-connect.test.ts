/**
 * ChatGPT sign-in completion: the pending sign-in must belong to the
 * caller and be fresh, and the pasted URL must match the started attempt.
 */

import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/db", () => ({
    db: { select: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

import { db } from "@/db";
import {
    completeChatGptSignIn,
    forgetChatGptModels,
    PENDING_SIGN_IN_TTL_MS,
    type PendingSignIn,
    resetChatGptModelCache,
    resolveChatGptModel,
    revokeChatGptCredential,
    sealPendingSignIn,
    unsealPendingSignIn,
} from "@/lib/ai/chatgpt/connect";
import {
    parseCredential,
    serializeCredential,
} from "@/lib/ai/chatgpt/credentials";
import { resetJwksCache } from "@/lib/ai/chatgpt/oauth";
import { ErrorCode } from "@/lib/errors";

function pending(overrides: Partial<PendingSignIn> = {}): PendingSignIn {
    return {
        userId: "user-1",
        state: "state-1",
        nonce: "nonce-1",
        codeVerifier: "verifier",
        hostId: "urn:uuid:h",
        clientId: null,
        createdAt: Date.now(),
        ...overrides,
    };
}

describe("pending sign-in cookie", () => {
    it("round-trips for the same user", () => {
        const p = pending();
        expect(unsealPendingSignIn(sealPendingSignIn(p), "user-1")).toEqual(p);
    });

    it("rejects another user's sign-in", () => {
        expect(() =>
            unsealPendingSignIn(sealPendingSignIn(pending()), "user-2"),
        ).toThrow(/expired/);
    });

    it("rejects an expired sign-in", () => {
        const p = pending({
            createdAt: Date.now() - PENDING_SIGN_IN_TTL_MS - 1,
        });
        expect(() =>
            unsealPendingSignIn(sealPendingSignIn(p), "user-1"),
        ).toThrow(/expired/);
    });

    it("rejects a missing or tampered cookie", () => {
        expect(() => unsealPendingSignIn(null, "user-1")).toThrow();
        expect(() => unsealPendingSignIn("aa:bb:cc", "user-1")).toThrow();
    });
});

describe("completeChatGptSignIn", () => {
    it("rejects a URL from a different sign-in attempt", async () => {
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending(),
                callbackUrl:
                    "http://127.0.0.1:1455/auth/callback?code=c&state=other&client_id=oaiapp_1",
            }),
        ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
    });

    it("requires the issued client id on a first registration", async () => {
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending(),
                callbackUrl:
                    "http://127.0.0.1:1455/auth/callback?code=c&state=state-1",
            }),
        ).rejects.toThrow(/client_id/);
    });

    it("rejects a malformed paste before calling OpenAI", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending(),
                callbackUrl: "hello",
            }),
        ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

describe("completeChatGptSignIn (happy path)", () => {
    const fetchMock = vi.fn();
    let privateKey: KeyObject;
    let jwk: Record<string, unknown>;
    let txExecute: Mock;
    let insertValues: Mock;
    let updateSet: Mock;

    function idToken(claims: Record<string, unknown>): string {
        const enc = (o: unknown) =>
            Buffer.from(JSON.stringify(o)).toString("base64url");
        const data = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
        return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
    }

    function json(body: unknown): Response {
        return new Response(JSON.stringify(body), {
            headers: { "Content-Type": "application/json" },
        });
    }

    /** Wire OpenAI's token, JWKS and models endpoints. */
    function serveOpenAi(
        scope = "openid email offline_access resource.invoke chatgpt.tokens.use.direct",
    ) {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith("/oauth/token")) {
                return json({
                    access_token: "at",
                    refresh_token: "rt",
                    id_token: idToken({
                        iss: "https://auth.openai.com",
                        aud: "oaiapp_new",
                        sub: "sub-1",
                        email: "me@example.com",
                        nonce: "nonce-1",
                        exp: Math.floor(Date.now() / 1000) + 3600,
                    }),
                    expires_in: 3600,
                    scope,
                });
            }
            if (url.endsWith("/jwks.json")) return json({ keys: [jwk] });
            if (url.endsWith("/oauth/revoke")) return new Response(null);
            if (url.endsWith("/v1/models")) {
                return json({
                    models: [
                        {
                            slug: "m-new",
                            display_name: "New",
                            visibility: "list",
                        },
                        {
                            slug: "m-old",
                            display_name: "Old",
                            visibility: "list",
                        },
                    ],
                });
            }
            throw new Error(`unexpected fetch ${url}`);
        });
    }

    /** tx: first select = existing ChatGPT row (FOR UPDATE), second = current enhancement default. */
    function mockTx(existing: unknown[], currentDefault: unknown[] = []) {
        txExecute = vi.fn(async () => undefined);
        const select = vi
            .fn()
            .mockReturnValueOnce({
                from: () => ({
                    where: () => ({
                        limit: () => ({ for: async () => existing }),
                    }),
                }),
            })
            .mockReturnValueOnce({
                from: () => ({
                    where: () => ({ limit: async () => currentDefault }),
                }),
            });
        insertValues = vi.fn(() => ({
            returning: async () => [{ id: "new-row" }],
        }));
        updateSet = vi.fn(() => ({ where: async () => undefined }));
        (db.transaction as Mock).mockImplementation(
            async (fn: (tx: unknown) => unknown) =>
                fn({
                    execute: txExecute,
                    select,
                    insert: () => ({ values: insertValues }),
                    update: () => ({ set: updateSet }),
                }),
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        resetJwksCache();
        resetChatGptModelCache();
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
        privateKey = pair.privateKey;
        jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1" };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const callback =
        "http://127.0.0.1:1455/auth/callback?code=code-1&state=state-1&client_id=oaiapp_new";

    it("exchanges with the issued client id and stores an encrypted credential on first connect", async () => {
        serveOpenAi();
        mockTx([]);

        const result = await completeChatGptSignIn({
            userId: "user-1",
            pending: pending(),
            callbackUrl: callback,
        });

        expect(result).toMatchObject({
            id: "new-row",
            email: "me@example.com",
            defaultModel: "m-new",
        });

        const tokenCall = fetchMock.mock.calls.find(([u]) =>
            String(u).endsWith("/oauth/token"),
        );
        const body = new URLSearchParams(tokenCall?.[1].body);
        expect(body.get("client_id")).toBe("oaiapp_new");
        expect(body.get("code")).toBe("code-1");
        expect(body.get("code_verifier")).toBe("verifier");

        // Serialized per user.
        expect(txExecute).toHaveBeenCalledTimes(1);

        const values = insertValues.mock.calls[0][0];
        expect(values).toMatchObject({
            userId: "user-1",
            provider: "ChatGPT",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "m-new",
            isDefaultTranscription: false,
            // No enhancement default yet, so ChatGPT becomes it.
            isDefaultEnhancement: true,
        });
        expect(values.apiKey).not.toContain("rt");
        expect(parseCredential(values.apiKey)).toMatchObject({
            clientId: "oaiapp_new",
            hostId: "urn:uuid:h",
            subject: "sub-1",
            email: "me@example.com",
            accessToken: "at",
            refreshToken: "rt",
        });
    });

    it("doesn't steal the enhancement default from an existing provider", async () => {
        serveOpenAi();
        mockTx([], [{ id: "openai-row" }]);
        await completeChatGptSignIn({
            userId: "user-1",
            pending: pending(),
            callbackUrl: callback,
        });
        expect(insertValues.mock.calls[0][0].isDefaultEnhancement).toBe(false);
    });

    it("updates the existing row on reconnect and keeps a still-offered model", async () => {
        serveOpenAi();
        mockTx([{ id: "existing-row", defaultModel: "m-old" }]);
        const result = await completeChatGptSignIn({
            userId: "user-1",
            pending: pending(),
            callbackUrl: callback,
        });
        expect(result).toMatchObject({
            id: "existing-row",
            defaultModel: "m-old",
        });
        expect(insertValues).not.toHaveBeenCalled();
        expect(updateSet.mock.calls[0][0]).toMatchObject({
            defaultModel: "m-old",
            isDefaultTranscription: false,
        });
    });

    it("refuses to store anything if plan usage wasn't granted", async () => {
        serveOpenAi("openid email offline_access");
        mockTx([]);
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending(),
                callbackUrl: callback,
            }),
        ).rejects.toThrow(/plan usage/);
        expect(db.transaction).not.toHaveBeenCalled();
    });

    it("rejects an ID token minted for another sign-in (nonce)", async () => {
        serveOpenAi();
        mockTx([]);
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending({ nonce: "different" }),
                callbackUrl: callback,
            }),
        ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
        expect(db.transaction).not.toHaveBeenCalled();
        // The refresh token OpenAI already issued is revoked, not leaked.
        const revoke = fetchMock.mock.calls.find(([u]) =>
            String(u).endsWith("/oauth/revoke"),
        );
        expect(new URLSearchParams(revoke?.[1].body).get("token")).toBe("rt");
    });

    it("still saves the sign-in when listing models fails", async () => {
        serveOpenAi();
        const base = fetchMock.getMockImplementation();
        fetchMock.mockImplementation(async (url: string, init: unknown) =>
            String(url).endsWith("/v1/models")
                ? new Response("{}", { status: 503 })
                : base?.(url, init),
        );
        mockTx([{ id: "existing-row", defaultModel: "m-old" }]);

        const result = await completeChatGptSignIn({
            userId: "user-1",
            pending: pending(),
            callbackUrl: callback,
        });

        expect(result).toMatchObject({
            id: "existing-row",
            defaultModel: "m-old",
            models: [],
        });
        expect(updateSet).toHaveBeenCalled();
        expect(
            fetchMock.mock.calls.some(([u]) =>
                String(u).endsWith("/oauth/revoke"),
            ),
        ).toBe(false);
    });

    it("revokes the issued token if saving the connection fails", async () => {
        serveOpenAi();
        (db.transaction as Mock).mockRejectedValueOnce(new Error("db down"));
        await expect(
            completeChatGptSignIn({
                userId: "user-1",
                pending: pending(),
                callbackUrl: callback,
            }),
        ).rejects.toThrow("db down");
        expect(
            fetchMock.mock.calls.some(([u]) =>
                String(u).endsWith("/oauth/revoke"),
            ),
        ).toBe(true);
    });
});

describe("resolveChatGptModel", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        resetChatGptModelCache();
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        models: [
                            { slug: "a", visibility: "list" },
                            { slug: "b", visibility: "list" },
                        ],
                    }),
                ),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("keeps a model the plan still offers", async () => {
        await expect(resolveChatGptModel("c1", "at", "b")).resolves.toBe("b");
    });

    it("replaces a stale saved model with the plan's first model", async () => {
        await expect(resolveChatGptModel("c1", "at", "retired")).resolves.toBe(
            "a",
        );
    });

    it("caches the plan's models per credential", async () => {
        await resolveChatGptModel("c1", "at", "a");
        await resolveChatGptModel("c1", "at", "b");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to the saved model if the list can't be loaded", async () => {
        fetchMock.mockRejectedValue(new TypeError("fetch failed"));
        await expect(resolveChatGptModel("c1", "at", "b")).resolves.toBe("b");
    });
});

describe("revokeChatGptCredential", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reports an unreadable credential as not revoked", async () => {
        await expect(revokeChatGptCredential("garbage")).resolves.toBe(false);
    });

    it("has nothing to revoke without a refresh token", async () => {
        const sealed = serializeCredential({
            v: 1,
            clientId: "c",
            hostId: "h",
            subject: "s",
            email: null,
            idToken: null,
            accessToken: "at",
            refreshToken: null,
            expiresAt: Date.now() + 60_000,
            earliestRefreshAt: null,
            scopes: [],
        });
        await expect(revokeChatGptCredential(sealed)).resolves.toBe(true);
    });
});

describe("model cache eviction", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        resetChatGptModelCache();
        fetchMock.mockReset();
        fetchMock.mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        models: [{ slug: "a", visibility: "list" }],
                    }),
                ),
        );
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("refetches after a credential is forgotten", async () => {
        await resolveChatGptModel("c1", "at", "a");
        forgetChatGptModels("c1");
        await resolveChatGptModel("c1", "at", "a");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("refetches once the cached list expires", async () => {
        vi.useFakeTimers();
        await resolveChatGptModel("c1", "at", "a");
        vi.advanceTimersByTime(11 * 60 * 1000);
        await resolveChatGptModel("c1", "at", "a");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
