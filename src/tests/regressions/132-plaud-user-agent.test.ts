// Regression for issue #132: every Plaud-bound fetch sends User-Agent.

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

const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

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
    const serialised = JSON.stringify(body);
    return {
        ok,
        status: init?.status ?? (ok ? 200 : 400),
        statusText: ok ? "OK" : "Error",
        headers: { get: () => null },
        json: () => Promise.resolve(body),
        // `safeParseJson` reads the body as text; mocks must mirror the
        // real `Response` interface for both shapes to stay valid.
        text: () => Promise.resolve(serialised),
    };
}

function userAgentFromCall(call: unknown[]): string | undefined {
    const init = call[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers["User-Agent"];
}

describe("issue #132: PLAUD_USER_AGENT constant", () => {
    it("is a non-empty browser-shaped UA", () => {
        expect(PLAUD_USER_AGENT).toBeTruthy();
        expect(PLAUD_USER_AGENT.length).toBeGreaterThan(20);
        expect(PLAUD_USER_AGENT.toLowerCase()).not.toContain("undici");
        expect(PLAUD_USER_AGENT.toLowerCase()).not.toContain("node-fetch");
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
        // With no cached workspaceId we 500 the workspace-list call so
        // the client falls back to the UT and the second fetch is the
        // recordings call itself.
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

        expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
        const recordingCall = mockFetch.mock.calls[1];
        expect(String(recordingCall[0])).toContain("/file/simple/web");
        expect(userAgentFromCall(recordingCall)).toBe(PLAUD_USER_AGENT);
    });
});
