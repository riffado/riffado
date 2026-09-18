/**
 * Regression for #273: China mainland `plaud.cn` hostname gates.
 *
 * Widens the existing `*.plaud.ai` SSRF allowlist to `plaud.cn` /
 * `*.plaud.cn` without admitting lookalikes. Pins all three gates
 * (`isValidPlaudApiUrl`, `shouldProxyPlaud`, `safePlaudUrl` via
 * `listPlaudWorkspaces`) plus the `cn` server preset.
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

const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
    PLAUD_PROXY_SCOPE: "all" as "all" | "api-only",
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { ErrorCode } from "@/lib/errors";
import { shouldProxyPlaud } from "@/lib/plaud/proxy";
import {
    isValidPlaudApiUrl,
    PLAUD_SERVERS,
    serverKeyFromApiBase,
} from "@/lib/plaud/servers";
import { listPlaudWorkspaces } from "@/lib/plaud/workspace";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof global.fetch;
    mockEnv.WEBSHARE_API_KEY = undefined;
    mockEnv.PLAUD_PROXY_SCOPE = "all";
});

afterEach(() => {
    global.fetch = originalFetch;
});

const ADMITTED_URLS = [
    "https://api.plaud.cn",
    "https://web.plaud.cn",
    "https://app.plaud.cn",
    "https://resource.plaud.cn",
    "https://plaud.cn",
    "https://API.PLAUD.CN",
    "https://api.plaud.ai",
    "https://api-euc1.plaud.ai",
    "https://api-apse1.plaud.ai",
    "https://resource.plaud.ai",
    "https://plaud.ai",
];

const LOOKALIKE_URLS = [
    "https://plaud.ai.evil.com",
    "https://plaud.cn.evil.com",
    "https://notplaud.ai",
    "https://notplaud.cn",
    "https://plaud.cn.attacker",
    "https://plaud.cn.attacker.com",
    "https://plaud.ai.attacker",
    "https://api.plaud.cn.",
    "https://plaud.cn.",
    "https://api.plaud.ai.",
    "https://plaud.ai.",
    "https://plaud.\u0441n",
    "https://pl\u0430ud.cn",
    "https://pl\u0430ud.ai",
    "https://api.plaud.cn@evil.com",
    "https://api.plaud.ai@evil.com",
    "https://plaud.cn%2eevil.com",
    "https://evilplaud.cn",
    "https://evilplaud.ai",
    "https://plaud.cn.localhost",
    "https://plaud.cn.evil.com/plaud.cn",
    "https://resource.plaud.cn.evil.com/audio.mp3",
    "http://api.plaud.cn",
    "http://api.plaud.ai",
    "ftp://api.plaud.cn",
    "https://example.com",
    "https://127.0.0.1",
];

const MALFORMED_URLS = ["", "not-a-url", "https://plaud.cn%00.evil.com"];

describe("issue #273: China region hostname gates", () => {
    it("admits only HTTPS plaud.ai and plaud.cn hosts", () => {
        const failures: string[] = [];
        for (const url of ADMITTED_URLS) {
            if (!isValidPlaudApiUrl(url)) {
                failures.push(`isValidPlaudApiUrl rejected ${url}`);
            }
            if (!shouldProxyPlaud(url)) {
                failures.push(`shouldProxyPlaud rejected ${url}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it("rejects lookalikes, trailing dots, userinfo, homoglyphs, and http", () => {
        const failures: string[] = [];
        for (const url of LOOKALIKE_URLS) {
            if (isValidPlaudApiUrl(url)) {
                failures.push(`isValidPlaudApiUrl admitted ${url}`);
            }
            if (shouldProxyPlaud(url)) {
                failures.push(`shouldProxyPlaud admitted ${url}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it("rejects malformed URLs at the boolean gates", () => {
        for (const url of MALFORMED_URLS) {
            expect(isValidPlaudApiUrl(url)).toBe(false);
            expect(shouldProxyPlaud(url)).toBe(false);
        }
    });

    it("safePlaudUrl rejects lookalikes before fetch", async () => {
        for (const url of LOOKALIKE_URLS) {
            await expect(
                listPlaudWorkspaces("ut.token", url),
            ).rejects.toMatchObject({
                name: "AppError",
                code: ErrorCode.PLAUD_INVALID_API_BASE,
            });
        }
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("safePlaudUrl admits api.plaud.cn and fetches that host", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            text: () =>
                Promise.resolve(
                    JSON.stringify({
                        status: 0,
                        data: {
                            workspaces: [
                                { workspace_id: "ws-cn", workspace_type: "0" },
                            ],
                        },
                    }),
                ),
        });

        const body = await listPlaudWorkspaces(
            "ut.token",
            "https://api.plaud.cn",
        );
        expect(body.data?.workspaces?.[0]?.workspace_id).toBe("ws-cn");
        expect(String(mockFetch.mock.calls[0][0])).toBe(
            "https://api.plaud.cn/team-app/workspaces/list?need_personal_workspace=true",
        );
    });

    it("skips .ai and .cn resource hosts when PLAUD_PROXY_SCOPE=api-only", () => {
        mockEnv.PLAUD_PROXY_SCOPE = "api-only";
        expect(shouldProxyPlaud("https://api.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api.plaud.cn/foo")).toBe(true);
        expect(shouldProxyPlaud("https://resource.plaud.ai/audio.mp3")).toBe(
            false,
        );
        expect(shouldProxyPlaud("https://resource.plaud.cn/audio.mp3")).toBe(
            false,
        );
        expect(shouldProxyPlaud("https://plaud.ai.evil.com/")).toBe(false);
        expect(shouldProxyPlaud("https://plaud.cn.evil.com/")).toBe(false);
    });

    it("keeps the cn preset consistent with isValidPlaudApiUrl", () => {
        expect(PLAUD_SERVERS.cn.apiBase).toBe("https://api.plaud.cn");
        expect(isValidPlaudApiUrl(PLAUD_SERVERS.cn.apiBase)).toBe(true);
        expect(serverKeyFromApiBase("https://api.plaud.cn")).toBe("cn");
        expect(serverKeyFromApiBase("https://web.plaud.cn")).toBe("custom");
        expect(serverKeyFromApiBase("https://api.plaud.ai")).toBe("global");
    });
});
