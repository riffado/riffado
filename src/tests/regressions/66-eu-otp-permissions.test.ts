/**
 * Regression test for issue #66:
 *   "Sync returns empty list for EU accounts -- OTP token has insufficient
 *   permissions"
 *
 * Plaud's regional servers (EU, APAC) require a workspace token (WT, JWT
 * typ="WT", 24h lifetime) on recording endpoints like /file/simple/web.
 * The user token (UT) returned by /auth/otp-login authenticates /user/me
 * and the workspace-token mint endpoints, but on /file/simple/web it
 * silently returns HTTP 200 with an empty list. PlaudClient must mint a WT
 * from the UT before hitting recording endpoints.
 *
 * These tests cover the four cache states for the persisted workspaceId:
 *   1. cache empty -> list workspaces -> mint WT -> expose new id
 *   2. cache hit   -> mint WT directly (no list call)
 *   3. cache stale -> mint 4xx -> invalidate -> list -> mint -> expose new id
 *   4. mint fails  -> fall back to UT (preserves pre-fix behavior)
 */

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";
import { ErrorCode as ErrorCodeRef } from "@/lib/errors";
import { PlaudClient } from "@/lib/plaud/client";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

beforeEach(() => {
    vi.clearAllMocks();
});

const UT = "ut.user.token";
const WT = "wt.workspace.token";
const API_BASE = "https://api-euc1.plaud.ai";
const WORKSPACE_ID = "ws_cKyt7F2Iec";
const NEW_WORKSPACE_ID = "ws_newDiscovered";

interface MockResponseInit {
    ok?: boolean;
    status?: number;
    body: unknown;
}

function mockResponse({ ok = true, status = 200, body }: MockResponseInit): {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get: () => null };
    json: () => Promise<unknown>;
} {
    return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        headers: { get: () => null },
        json: () => Promise.resolve(body),
    };
}

function workspaceListResponse(workspaceId: string) {
    return mockResponse({
        body: {
            status: 0,
            data: {
                workspaces: [
                    {
                        workspace_id: workspaceId,
                        member_id: "mem_x",
                        name: "Personal",
                        role: "admin",
                        status: "active",
                        workspace_type: "0",
                    },
                ],
            },
        },
    });
}

function workspaceTokenResponse(workspaceToken: string) {
    return mockResponse({
        body: {
            status: 0,
            data: {
                status: 0,
                workspace_token: workspaceToken,
                expires_in: 86400,
                wt_expires_at: 0,
                refresh_token: "refresh.token",
                refresh_expires_in: 2592000,
                refresh_expires_at: 0,
                workspace_id: WORKSPACE_ID,
                member_id: "mem_x",
                role: "admin",
            },
        },
    });
}

function recordingsResponse() {
    return mockResponse({
        body: {
            status: 0,
            msg: "success",
            data_file_total: 1,
            data_file_list: [{ id: "rec_1", filename: "test.mp3" }],
        },
    });
}

/**
 * Pull the Authorization header off a mockFetch invocation.
 * Our PlaudClient sends `Bearer <token>` (capital B); `fetch` is called as
 * `fetch(url, { headers: { Authorization: ... } })`.
 */
function authHeaderFromCall(call: unknown[]): string {
    const init = call[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.Authorization ?? "";
}

/**
 * Normalize the URL argument of a mockFetch invocation to a string. The
 * PlaudClient passes a string; the workspace.ts helpers pass a URL object
 * (built via `new URL(path, apiBase)` for SSRF sanitization).
 */
function urlFromCall(call: unknown[]): string {
    const u = call[0];
    return u instanceof URL ? u.href : String(u);
}

describe("issue #66: workspace token (WT) is required on EU recording endpoints", () => {
    it("cache empty: lists workspaces, mints WT, sends WT on /file/simple/web", async () => {
        // 1. workspaces/list   2. workspace/token mint   3. /file/simple/web
        mockFetch
            .mockResolvedValueOnce(workspaceListResponse(WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        const result = await client.getRecordings(0, 10);

        expect(result.data_file_total).toBe(1);
        expect(mockFetch).toHaveBeenCalledTimes(3);

        // First call hits the workspaces/list endpoint with the UT.
        const listCall = mockFetch.mock.calls[0];
        expect(urlFromCall(listCall)).toContain("/team-app/workspaces/list");
        expect(authHeaderFromCall(listCall)).toBe(`Bearer ${UT}`);

        // Second call mints the WT -- also authenticated with the UT.
        const mintCall = mockFetch.mock.calls[1];
        expect(urlFromCall(mintCall)).toContain(
            `/user-app/auth/workspace/token/${WORKSPACE_ID}`,
        );
        expect(authHeaderFromCall(mintCall)).toBe(`Bearer ${UT}`);
        expect((mintCall[1] as RequestInit).method).toBe("POST");

        // Third call (the actual recordings fetch) MUST use the WT, not UT.
        // This is the load-bearing assertion for the bug.
        const recCall = mockFetch.mock.calls[2];
        expect(urlFromCall(recCall)).toContain("/file/simple/web");
        expect(authHeaderFromCall(recCall)).toBe(`Bearer ${WT}`);

        // Resolved workspace id is now exposed for the caller to persist.
        expect(client.workspaceId).toBe(WORKSPACE_ID);
        expect(client.usingUserTokenFallback).toBe(false);
    });

    it("cache hit: skips workspaces/list, mints WT directly", async () => {
        mockFetch
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE, WORKSPACE_ID);
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(2);

        // No workspaces/list call -- went straight to mint.
        expect(urlFromCall(mockFetch.mock.calls[0])).toContain(
            `/user-app/auth/workspace/token/${WORKSPACE_ID}`,
        );
        expect(urlFromCall(mockFetch.mock.calls[1])).toContain(
            "/file/simple/web",
        );
        expect(authHeaderFromCall(mockFetch.mock.calls[1])).toBe(
            `Bearer ${WT}`,
        );
        expect(client.workspaceId).toBe(WORKSPACE_ID);
    });

    it("cache stale: mint 4xx, invalidates, relists, exposes new workspaceId", async () => {
        // 1. mint with stale id -> 404
        // 2. workspaces/list -> returns NEW workspace id
        // 3. mint with new id -> WT
        // 4. /file/simple/web with WT
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    ok: false,
                    status: 404,
                    body: { status: 404, msg: "workspace not found" },
                }),
            )
            .mockResolvedValueOnce(workspaceListResponse(NEW_WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE, "ws_stale");
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(4);
        expect(urlFromCall(mockFetch.mock.calls[0])).toContain(
            "/user-app/auth/workspace/token/ws_stale",
        );
        expect(urlFromCall(mockFetch.mock.calls[1])).toContain(
            "/team-app/workspaces/list",
        );
        expect(urlFromCall(mockFetch.mock.calls[2])).toContain(
            `/user-app/auth/workspace/token/${NEW_WORKSPACE_ID}`,
        );
        expect(authHeaderFromCall(mockFetch.mock.calls[3])).toBe(
            `Bearer ${WT}`,
        );

        // Caller will persist this back to plaud_connections.workspace_id.
        expect(client.workspaceId).toBe(NEW_WORKSPACE_ID);
    });

    it("workspace mint fails entirely: falls back to UT (preserves global users)", async () => {
        // workspaces/list -> 500. Client gives up on WT and uses UT directly.
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    ok: false,
                    status: 500,
                    body: { status: 500, msg: "server error" },
                }),
            )
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        await client.getRecordings(0, 10);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        // Recording call uses UT, not WT.
        expect(authHeaderFromCall(mockFetch.mock.calls[1])).toBe(
            `Bearer ${UT}`,
        );
        expect(client.usingUserTokenFallback).toBe(true);
        expect(client.workspaceId).toBeUndefined();
    });

    it("concurrent requests share a single WT mint", async () => {
        // 1. workspaces/list   2. mint WT   3+4. two parallel /file/simple/web
        mockFetch
            .mockResolvedValueOnce(workspaceListResponse(WORKSPACE_ID))
            .mockResolvedValueOnce(workspaceTokenResponse(WT))
            .mockResolvedValueOnce(recordingsResponse())
            .mockResolvedValueOnce(recordingsResponse());

        const client = new PlaudClient(UT, API_BASE);
        await Promise.all([
            client.getRecordings(0, 10),
            client.getRecordings(10, 10),
        ]);

        // 4 total calls: 1 list + 1 mint + 2 recordings (NOT 1+1+1+1+2 = 6).
        expect(mockFetch).toHaveBeenCalledTimes(4);
        expect(authHeaderFromCall(mockFetch.mock.calls[2])).toBe(
            `Bearer ${WT}`,
        );
        expect(authHeaderFromCall(mockFetch.mock.calls[3])).toBe(
            `Bearer ${WT}`,
        );
    });
});

// ── 401 from mint propagates as PLAUD_INVALID_TOKEN ─────────────────────
//
// Regression for cubic P1 review on PR #97: a 401 from
// mintPlaudWorkspaceToken must NOT be classified `stale=true`. If it
// were, resolveWorkspaceToken would swallow the auth-typed error and
// fall through to a relist + remint round-trip, and any non-auth
// failure on that relist would mask the original PLAUD_INVALID_TOKEN
// signal that the route layer needs to trigger reconnect UI.
describe("resolveWorkspaceToken: 401 mint propagates as PLAUD_INVALID_TOKEN", () => {
    it("throws PLAUD_INVALID_TOKEN (401) from cached-mint without relisting", async () => {
        // Cache hit → mint → 401. Must propagate verbatim, NOT trigger a
        // /team-app/workspaces/list relist.
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                ok: false,
                status: 401,
                body: { status: 401, msg: "bad token" },
            }),
        );

        const { resolveWorkspaceToken } = await import("@/lib/plaud/workspace");
        const err = await resolveWorkspaceToken(
            UT,
            API_BASE,
            "ws_cached",
        ).catch((e) => e);

        expect(err).toMatchObject({
            code: ErrorCodeRef.PLAUD_INVALID_TOKEN,
            statusCode: 401,
        });
        // Single fetch — the mint call — no relist round-trip.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(urlFromCall(mockFetch.mock.calls[0])).toContain(
            "/user-app/auth/workspace/token/ws_cached",
        );
    });
});
