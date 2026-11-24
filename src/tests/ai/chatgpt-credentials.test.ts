/**
 * ChatGPT credential storage and refresh: refresh timing, token rotation,
 * single-flight refresh (OpenAI rejects reused refresh tokens) and the
 * reconnect error when the session is gone.
 */

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
    db: {
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

import { db } from "@/db";
import {
    applyTokenResponse,
    type ChatGptCredential,
    getChatGptAccessToken,
    needsRefresh,
    parseCredential,
    serializeCredential,
} from "@/lib/ai/chatgpt/credentials";
import { ErrorCode } from "@/lib/errors";

const fetchMock = vi.fn();

function credential(
    overrides: Partial<ChatGptCredential> = {},
): ChatGptCredential {
    return {
        v: 1,
        clientId: "oaiapp_1",
        hostId: "urn:uuid:h",
        subject: "sub",
        email: "me@example.com",
        idToken: "id",
        accessToken: "old-at",
        refreshToken: "old-rt",
        expiresAt: Date.now() + 3600_000,
        earliestRefreshAt: null,
        scopes: [],
        ...overrides,
    };
}

let stored: string;
let updateSet: Mock;

let lockStrength: Mock;

/**
 * The refresh runs in `db.transaction` and reads the row with
 * `SELECT ... FOR UPDATE`; the tx mock reads/writes `stored`.
 */
function mockDb() {
    lockStrength = vi.fn(async () => [{ apiKey: stored }]);
    const select = vi.fn(() => ({
        from: () => ({
            where: () => ({
                limit: () => ({ for: lockStrength }),
            }),
        }),
    }));
    updateSet = vi.fn((values: { apiKey: string }) => {
        stored = values.apiKey;
        return { where: async () => undefined };
    });
    const update = vi.fn(() => ({ set: updateSet }));
    (db.transaction as Mock).mockImplementation(
        async (fn: (tx: unknown) => unknown) => fn({ select, update }),
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mockDb();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("serialize/parse", () => {
    it("round-trips through the encrypted api_key column", () => {
        const c = credential();
        const sealed = serializeCredential(c);
        expect(sealed).not.toContain("old-at");
        expect(parseCredential(sealed)).toEqual(c);
    });

    it("asks to reconnect when the stored value isn't a credential", () => {
        try {
            parseCredential("garbage");
            expect.unreachable();
        } catch (error) {
            expect(error).toMatchObject({
                code: ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            });
        }
    });
});

describe("needsRefresh", () => {
    const now = 1_000_000_000_000;

    it("keeps a token with plenty of life left", () => {
        expect(
            needsRefresh(credential({ expiresAt: now + 30 * 60_000 }), now),
        ).toBe(false);
    });

    it("refreshes a token about to expire", () => {
        expect(needsRefresh(credential({ expiresAt: now + 30_000 }), now)).toBe(
            true,
        );
    });

    it("waits for earliest_refresh_at while the token is still valid", () => {
        expect(
            needsRefresh(
                credential({
                    expiresAt: now + 30_000,
                    earliestRefreshAt: now + 10_000,
                }),
                now,
            ),
        ).toBe(false);
    });

    it("refreshes an expired token regardless of earliest_refresh_at", () => {
        expect(
            needsRefresh(
                credential({
                    expiresAt: now - 1,
                    earliestRefreshAt: now + 10_000,
                }),
                now,
            ),
        ).toBe(true);
    });
});

describe("applyTokenResponse", () => {
    it("keeps the previous refresh token when none is returned", () => {
        const next = applyTokenResponse(
            credential(),
            { access_token: "new-at", expires_in: 60 },
            0,
        );
        expect(next.accessToken).toBe("new-at");
        expect(next.refreshToken).toBe("old-rt");
        expect(next.expiresAt).toBe(60_000);
    });

    it("stores a rotated refresh token and granted scopes", () => {
        const next = applyTokenResponse(credential(), {
            access_token: "new-at",
            refresh_token: "new-rt",
            scope: "openid resource.invoke",
            earliest_refresh_at: 1_700_000_000,
        });
        expect(next.refreshToken).toBe("new-rt");
        expect(next.scopes).toEqual(["openid", "resource.invoke"]);
        expect(next.earliestRefreshAt).toBe(1_700_000_000_000);
    });
});

describe("getChatGptAccessToken", () => {
    const row = () => ({ id: "cred-1", userId: "user-1", apiKey: stored });

    it("returns the stored token without refreshing when it's fresh", async () => {
        stored = serializeCredential(credential());
        await expect(getChatGptAccessToken(row())).resolves.toBe("old-at");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refreshes once for concurrent callers and persists rotated tokens", async () => {
        stored = serializeCredential(credential({ expiresAt: Date.now() - 1 }));
        fetchMock.mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        access_token: "new-at",
                        refresh_token: "new-rt",
                        expires_in: 3600,
                    }),
                ),
        );

        const staleRow = row();
        const [a, b] = await Promise.all([
            getChatGptAccessToken(staleRow),
            getChatGptAccessToken(staleRow),
        ]);
        expect(a).toBe("new-at");
        expect(b).toBe("new-at");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("client_id")).toBe("oaiapp_1");
        expect(body.get("refresh_token")).toBe("old-rt");

        expect(parseCredential(stored).refreshToken).toBe("new-rt");
        // Read under a row lock so other replicas / a reconnect serialize.
        expect(lockStrength).toHaveBeenCalledWith("update");
    });

    it("uses a token another request already refreshed instead of reusing the old refresh token", async () => {
        const staleRow = {
            id: "cred-1",
            userId: "user-1",
            apiKey: serializeCredential(
                credential({ expiresAt: Date.now() - 1 }),
            ),
        };
        // Meanwhile the DB already holds a freshly refreshed credential.
        stored = serializeCredential(
            credential({ accessToken: "fresh-at", refreshToken: "fresh-rt" }),
        );
        await expect(getChatGptAccessToken(staleRow)).resolves.toBe("fresh-at");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks the user to reconnect when the refresh token is dead", async () => {
        stored = serializeCredential(credential({ expiresAt: Date.now() - 1 }));
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: "refresh_token_expired" }), {
                status: 400,
            }),
        );
        await expect(getChatGptAccessToken(row())).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            details: expect.objectContaining({ reconnect: true }),
        });
    });
});
