/**
 * Regression test for issue #132:
 *   "Cloudflare 403s Node fetch with no User-Agent; sync silently returns
 *   no recordings on datacenter IPs"
 *
 * Plaud's API sits behind Cloudflare's WAF, which 403s requests from Node's
 * default fetch (undici sends no User-Agent header). On datacenter IPs this
 * is essentially guaranteed; on residential IPs it's environment-dependent.
 *
 * The fix sets a browser-like User-Agent on every fetch in `src/lib/plaud/`.
 * The presigned-S3 download in `client.ts:downloadRecording` is intentionally
 * left alone because it hits AWS directly, not Cloudflare.
 *
 * These tests assert the User-Agent header is sent on each of the six
 * affected call sites. They do NOT validate the exact UA string; that would
 * couple the test to a value the maintainers may rotate when Cloudflare
 * heuristics change. The contract is: "we send a non-empty browser-shaped
 * UA, not node/undici/empty".
 *
 * Six call sites covered:
 *   1. PlaudClient.request               (client.ts)
 *   2. listPlaudWorkspaces               (workspace.ts)
 *   3. mintPlaudWorkspaceToken           (workspace.ts)
 *   4. plaudSendCode                     (auth.ts)
 *   5. plaudVerifyOtp                    (auth.ts)
 *   6. fetchPlaudUserMeEmail             (auth.ts)
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
import {
    fetchPlaudUserMeEmail,
    plaudSendCode,
    plaudVerifyOtp,
} from "@/lib/plaud/auth";
import { PlaudClient } from "@/lib/plaud/client";
import { PLAUD_USER_AGENT } from "@/lib/plaud/servers";
import {
    listPlaudWorkspaces,
    mintPlaudWorkspaceToken,
} from "@/lib/plaud/workspace";

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
    mockFetch.mockReset();
});

const UT = "ut.user.token";
const API_BASE = "https://api-apse1.plaud.ai";

function mockJson(body: unknown, init?: { ok?: boolean; status?: number }) {
    const ok = init?.ok ?? true;
    return {
        ok,
        status: init?.status ?? (ok ? 200 : 400),
        statusText: ok ? "OK" : "Error",
        headers: { get: () => null },
        json: () => Promise.resolve(body),
    };
}

/**
 * Pull the User-Agent header off a mockFetch call. Headers can be supplied
 * as a Record<string, string> (every call site in src/lib/plaud/ uses this
 * shape today). Returns undefined if absent so test assertions can be
 * exact rather than loose.
 */
function userAgentFromCall(call: unknown[]): string | undefined {
    const init = call[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers["User-Agent"];
}

describe("issue #132: PLAUD_USER_AGENT constant", () => {
    it("is a non-empty browser-shaped UA (not node/undici/empty)", () => {
        expect(PLAUD_USER_AGENT).toBeTruthy();
        expect(PLAUD_USER_AGENT.length).toBeGreaterThan(20);
        // Cloudflare WAF flags these as obvious automation. Negative
        // assertions guard against an accidental rollback to the default
        // undici UA or a copy-paste of "node-fetch" / similar.
        expect(PLAUD_USER_AGENT.toLowerCase()).not.toContain("undici");
        expect(PLAUD_USER_AGENT.toLowerCase()).not.toContain("node-fetch");
        // Browser-shaped: starts with "Mozilla/5.0". This is the same
        // convention every real browser uses and what Plaud's own web
        // client sends; matching it keeps us indistinguishable from
        // normal user traffic on a WAF level.
        expect(PLAUD_USER_AGENT).toMatch(/^Mozilla\/5\.0/);
    });
});

describe("issue #132: every Plaud API fetch sends User-Agent", () => {
    it("auth.ts: plaudSendCode sends UA", async () => {
        mockFetch.mockResolvedValueOnce(
            mockJson({ status: 0, token: "otp.session.token" }),
        );
        await plaudSendCode("user@example.com", API_BASE);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(userAgentFromCall(mockFetch.mock.calls[0])).toBe(
            PLAUD_USER_AGENT,
        );
    });

    it("auth.ts: plaudVerifyOtp sends UA", async () => {
        mockFetch.mockResolvedValueOnce(
            mockJson({ status: 0, access_token: "at.token" }),
        );
        await plaudVerifyOtp("123456", "otp.session.token", API_BASE);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(userAgentFromCall(mockFetch.mock.calls[0])).toBe(
            PLAUD_USER_AGENT,
        );
    });

    it("auth.ts: fetchPlaudUserMeEmail sends UA", async () => {
        mockFetch.mockResolvedValueOnce(
            mockJson({ status: 0, data: { email: "user@example.com" } }),
        );
        await fetchPlaudUserMeEmail("at.token", API_BASE);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(userAgentFromCall(mockFetch.mock.calls[0])).toBe(
            PLAUD_USER_AGENT,
        );
    });

    it("workspace.ts: listPlaudWorkspaces sends UA", async () => {
        mockFetch.mockResolvedValueOnce(
            mockJson({
                status: 0,
                data: {
                    workspaces: [
                        {
                            workspace_id: "ws_1",
                            member_id: "mem_1",
                            name: "Personal",
                            role: "admin",
                            status: "active",
                            workspace_type: "0",
                        },
                    ],
                },
            }),
        );
        await listPlaudWorkspaces(UT, API_BASE);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(userAgentFromCall(mockFetch.mock.calls[0])).toBe(
            PLAUD_USER_AGENT,
        );
    });

    it("workspace.ts: mintPlaudWorkspaceToken sends UA", async () => {
        mockFetch.mockResolvedValueOnce(
            mockJson({
                status: 0,
                data: { workspace_token: "wt.token" },
            }),
        );
        await mintPlaudWorkspaceToken(UT, "ws_1", API_BASE);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(userAgentFromCall(mockFetch.mock.calls[0])).toBe(
            PLAUD_USER_AGENT,
        );
    });

    it("client.ts: PlaudClient.request sends UA on recording endpoints", async () => {
        // Two-step flow: workspace token mint (WT not needed for this
        // assertion — we just need the request to reach /file/simple/web),
        // then the actual recording fetch. We force the UT-fallback path
        // by failing the mint, which keeps the test focused on the second
        // fetch (the one inside PlaudClient.request).
        mockFetch
            .mockResolvedValueOnce(
                mockJson({ status: 500 }, { ok: false, status: 500 }),
            )
            .mockResolvedValueOnce(
                mockJson({
                    status: 0,
                    msg: "success",
                    data_file_total: 0,
                    data_file_list: [],
                }),
            );

        const client = new PlaudClient(UT, API_BASE);
        await client.getRecordings(0, 10);

        // We assert UA on the second call (the one PlaudClient.request
        // makes). The first call goes through workspace.ts which is
        // covered above; here we want the client.ts contract.
        expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
        const recordingCall = mockFetch.mock.calls[1];
        expect(String(recordingCall[0])).toContain("/file/simple/web");
        expect(userAgentFromCall(recordingCall)).toBe(PLAUD_USER_AGENT);
    });
});
