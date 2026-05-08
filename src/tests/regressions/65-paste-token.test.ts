/**
 * Regression test for issue #65:
 *   "Add Google/Apple OAuth sign-in to support users who registered via
 *   those methods"
 *
 * Real Google/Apple OAuth on Plaud's behalf is structurally impossible from
 * a non-plaud.ai origin (Google's authorized-origins enforcement). The
 * shipping fix is a paste-token connect path: the user grabs the bearer
 * from a logged-in web.plaud.ai session and pastes it into OpenPlaud. This
 * file pins the validation surface of /api/plaud/auth/connect-token plus
 * the shape of decodeAccessTokenExpiry, so we don't silently regress the
 * one escape hatch Google/Apple-registered Plaud users have today.
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
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/db", () => {
    const select = vi.fn();
    const insert = vi.fn();
    const update = vi.fn();
    const execute = vi.fn().mockResolvedValue(undefined);
    // persist-connection wraps the upsert in db.transaction(async tx => ...)
    // and calls tx.execute (advisory lock), tx.select, tx.insert, tx.update.
    // The mock proxies the tx object back to the same vi.fn()s so existing
    // expectations on db.insert/db.update keep working.
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ select, insert, update, execute }),
    );
    return {
        db: { select, insert, update, transaction },
    };
});

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

// Routes use requireApiSession from auth-server (suspension-aware,
// throws AppError on failure). Forward the existing
// auth.api.getSession mock through it so test setups keep working
// without each test having to add suspension fixtures.
vi.mock("@/lib/auth-server", async () => {
    const { auth } = await import("@/lib/auth");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    return {
        requireApiSession: async (request: Request) => {
            const session = await auth.api.getSession({
                headers: request.headers,
            });
            if (!session?.user) {
                throw new AppError(
                    ErrorCode.AUTH_SESSION_MISSING,
                    "Unauthorized",
                    401,
                );
            }
            return session;
        },
    };
});

import { POST } from "@/app/api/plaud/auth/connect-token/route";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { ErrorCode } from "@/lib/errors";
import { decodeAccessTokenExpiry, plaudVerifyOtp } from "@/lib/plaud/auth";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
    // Suppress the route's console.log/console.warn/console.error during
    // negative-path tests to keep test output readable.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    global.fetch = originalFetch;
});

// ── Test helpers ────────────────────────────────────────────────────────────

const USER_ID = "user-65";

function authedSession() {
    (auth.api.getSession as unknown as Mock).mockResolvedValue({
        user: { id: USER_ID },
    });
}

function unauthed() {
    (auth.api.getSession as unknown as Mock).mockResolvedValue(null);
}

/** Build a JWT with arbitrary payload (signature is junk; we never verify). */
function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.signature-not-checked`;
}

function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/plaud/auth/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

// ── decodeAccessTokenExpiry (pure unit) ─────────────────────────────────────

describe("decodeAccessTokenExpiry", () => {
    it("decodes a valid JWT exp into a Date", () => {
        const futureSec = Math.floor(Date.now() / 1000) + 3600;
        const tok = makeJwt({ exp: futureSec });
        const result = decodeAccessTokenExpiry(tok);
        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBe(futureSec * 1000);
    });

    it("returns null for a non-JWT string", () => {
        expect(decodeAccessTokenExpiry("not-a-jwt")).toBeNull();
        expect(decodeAccessTokenExpiry("a.b")).toBeNull();
        expect(decodeAccessTokenExpiry("")).toBeNull();
    });

    it("returns null when payload has no exp", () => {
        expect(decodeAccessTokenExpiry(makeJwt({ sub: "x" }))).toBeNull();
    });

    it("returns null when payload's exp is not a finite number", () => {
        expect(decodeAccessTokenExpiry(makeJwt({ exp: "soon" }))).toBeNull();
        expect(
            decodeAccessTokenExpiry(makeJwt({ exp: Number.NaN })),
        ).toBeNull();
    });

    it("tolerates base64url payloads requiring padding", () => {
        // Pick a payload whose JSON length % 4 != 0 so base64url omits '='.
        const tok = makeJwt({ exp: 1700000000, x: "ab" });
        expect(decodeAccessTokenExpiry(tok)).toBeInstanceOf(Date);
    });
});

// ── /api/plaud/auth/connect-token validation surface ────────────────────────

// ── Structured Plaud errors (replaces isUserActionablePlaudError) ───────────
//
// Resolved cubic P1: 5xx Plaud failures used to surface as 400
// "fix your token" because the route inferred user-actionability from
// the error message string. Plaud helpers now throw `AppError` carrying
// `code` + `statusCode`; the route's `apiHandler` honours the status
// verbatim. Lock that down here.
describe("plaudVerifyOtp throws structured AppError", () => {
    it("throws PLAUD_OTP_INVALID (400) when Plaud returns a status:-N body with no token", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () =>
                Promise.resolve({
                    status: -1,
                    msg: "Invalid verification code",
                }),
        });
        const err = await plaudVerifyOtp(
            "000000",
            "otp.token",
            "https://api.plaud.ai",
        ).catch((e) => e);
        expect(err).toMatchObject({
            code: ErrorCode.PLAUD_OTP_INVALID,
            statusCode: 400,
            message: "Invalid verification code",
        });
    });
});

describe("POST /api/plaud/auth/connect-token (validation)", () => {
    it("401s without a session", async () => {
        unauthed();
        const res = await POST(makeRequest({ accessToken: "x" }));
        expect(res.status).toBe(401);
        // No Plaud calls were made.
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("400s when accessToken is missing", async () => {
        authedSession();
        const res = await POST(makeRequest({}));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/accessToken is required/);
    });

    it("400s when accessToken is not JWT-shaped (catches stray nonsense)", async () => {
        authedSession();
        const res = await POST(makeRequest({ accessToken: "not-a-jwt" }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(
            /doesn't look like a Plaud access token/,
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("400s when accessToken's exp is in the past (UX hint, not security)", async () => {
        authedSession();
        const expiredSec = Math.floor(Date.now() / 1000) - 60;
        const res = await POST(
            makeRequest({ accessToken: makeJwt({ exp: expiredSec }) }),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/already expired/);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("400s on a non-plaud.ai apiBase (SSRF guard)", async () => {
        authedSession();
        const futureSec = Math.floor(Date.now() / 1000) + 3600;
        const res = await POST(
            makeRequest({
                accessToken: makeJwt({ exp: futureSec }),
                apiBase: "https://evil.example.com",
            }),
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid API base/);
        expect(body.code).toBe(ErrorCode.PLAUD_INVALID_API_BASE);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("strips a leading 'Bearer ' if the user pasted the whole header value", async () => {
        // Happy(ish) path: validate that we reach Plaud, then bail at
        // /device/list (we have not configured a successful db chain).
        authedSession();

        // Failure on /user/me (best-effort) → fetchPlaudUserMeEmail returns
        // null. Then listPlaudWorkspaces → 401 → swallowed. Then
        // listDevices → 401 → PlaudClient throws AppError(PLAUD_INVALID_TOKEN,
        // 401) → apiHandler returns 401 to the user ("reconnect Plaud",
        // not "fix your input").
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            headers: { get: () => null },
            json: () => Promise.resolve({ status: 401, msg: "bad token" }),
        });

        const futureSec = Math.floor(Date.now() / 1000) + 3600;
        const res = await POST(
            makeRequest({
                accessToken: `Bearer ${makeJwt({ exp: futureSec })}`,
            }),
        );

        expect(res.status).toBe(401);
        // The Plaud request used the unwrapped token (no double "Bearer ").
        const calls = mockFetch.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [, init] of calls) {
            const auth = (init?.headers as Record<string, string>)
                ?.Authorization;
            if (auth) {
                expect(auth).toMatch(/^Bearer eyJ/); // single "Bearer ", JWT body starts with eyJ
                expect(auth).not.toMatch(/Bearer Bearer/);
            }
        }
    });
});

// ── Happy-path orchestration ────────────────────────────────────────────────

describe("POST /api/plaud/auth/connect-token (happy path)", () => {
    it("validates token via /device/list, encrypts, and upserts", async () => {
        authedSession();

        // Drizzle chain mock: select-from-where-limit returns [] (no
        // existing connection), so we go down the insert branch. Same for
        // each device.
        const selectChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        };
        (db.select as Mock).mockReturnValue(selectChain);

        const insertValuesSpy = vi.fn().mockResolvedValue(undefined);
        (db.insert as Mock).mockReturnValue({ values: insertValuesSpy });

        // Plaud responses, in call order:
        //   1. /user/me  → email enrichment (best-effort)
        //   2. /team-app/workspaces/list → workspace discovery
        //   3. /user-app/auth/workspace/token/<id> → mint WT
        //   4. /device/list → end-to-end validation
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve({
                        status: 0,
                        data: { email: "Kacper@Example.com" },
                    }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve({
                        status: 0,
                        data: {
                            workspaces: [
                                {
                                    workspace_id: "ws_personal",
                                    member_id: "mem_x",
                                    name: "Personal",
                                    role: "admin",
                                    status: "active",
                                    workspace_type: "0",
                                },
                            ],
                        },
                    }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve({
                        status: 0,
                        data: {
                            status: 0,
                            workspace_token: "wt.workspace.token",
                            expires_in: 86400,
                            wt_expires_at: 0,
                            refresh_token: "refresh.token",
                            refresh_expires_in: 2592000,
                            refresh_expires_at: 0,
                            workspace_id: "ws_personal",
                            member_id: "mem_x",
                            role: "admin",
                        },
                    }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve({
                        status: 0,
                        msg: "success",
                        data_devices: [
                            {
                                sn: "SN-1",
                                name: "My Plaud",
                                model: "Note",
                                version_number: 100,
                            },
                        ],
                    }),
            });

        const futureSec = Math.floor(Date.now() / 1000) + 3600;
        const res = await POST(
            makeRequest({
                accessToken: makeJwt({ exp: futureSec }),
                apiBase: "https://api-euc1.plaud.ai",
                source: "paste",
            }),
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.devices).toHaveLength(1);

        // Connection was inserted with the encrypted token and the lowercased
        // email captured from /user/me.
        expect(insertValuesSpy).toHaveBeenCalled();
        const connectionInsert = insertValuesSpy.mock.calls.find((c) => {
            const v = c[0];
            return v && typeof v === "object" && "bearerToken" in v;
        });
        expect(connectionInsert).toBeTruthy();
        const connRow = connectionInsert?.[0] as {
            userId: string;
            bearerToken: string;
            apiBase: string;
            plaudEmail: string | null;
            workspaceId: string | null;
        };
        expect(connRow.userId).toBe(USER_ID);
        expect(connRow.apiBase).toBe("https://api-euc1.plaud.ai");
        expect(connRow.plaudEmail).toBe("kacper@example.com"); // lowercased
        expect(connRow.workspaceId).toBe("ws_personal");
        // bearerToken is encrypted, NOT the raw JWT.
        expect(connRow.bearerToken).not.toContain("eyJ");

        // Device row was inserted, scoped to this user.
        const deviceInsert = insertValuesSpy.mock.calls.find((c) => {
            const v = c[0];
            return v && typeof v === "object" && "serialNumber" in v;
        });
        expect(deviceInsert).toBeTruthy();
        expect(
            (deviceInsert?.[0] as { serialNumber: string }).serialNumber,
        ).toBe("SN-1");
    });
});
