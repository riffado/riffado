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

const mockWreq = vi.hoisted(() => ({
    fetch: vi.fn() as Mock,
}));

vi.mock("wreq-js", () => ({
    fetch: mockWreq.fetch,
}));

import { _resetPlaudFetchForTest, plaudFetch } from "@/lib/plaud/fetch";
import {
    _resetPlaudProxyCacheForTest,
    isPlaudProxyConfigured,
    shouldProxyPlaud,
} from "@/lib/plaud/proxy";

const originalFetch = global.fetch;
let mockFetch: Mock;

const PLAUD_API_URL =
    "https://api-euc1.plaud.ai/team-app/workspaces/list?need_personal_workspace=true";

function okResponse(): Response {
    return new Response('{"status":0,"data":{"workspaces":[]}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function forbiddenResponse(): Response {
    return new Response("<html>blocked</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
    });
}

function webshareList(proxies: Array<Record<string, unknown>>): Response {
    return new Response(JSON.stringify({ results: proxies }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

const sampleProxy = {
    id: "p1",
    username: "u",
    password: "p",
    proxy_address: "1.2.3.4",
    port: 8080,
    valid: true,
};
const otherProxy = {
    id: "p2",
    username: "u2",
    password: "p2",
    proxy_address: "5.6.7.8",
    port: 8081,
    valid: true,
};

beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof global.fetch;
    mockWreq.fetch.mockReset();
    mockEnv.WEBSHARE_API_KEY = undefined;
    mockEnv.PLAUD_PROXY_SCOPE = "all";
    _resetPlaudProxyCacheForTest();
    _resetPlaudFetchForTest();
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe("shouldProxyPlaud", () => {
    it("matches Plaud API hosts over HTTPS", () => {
        expect(shouldProxyPlaud("https://api.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api-euc1.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api-apse1.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://resource.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://plaud.ai/")).toBe(true);
    });

    it("rejects non-Plaud, http, and malformed URLs", () => {
        expect(shouldProxyPlaud("https://example.com/")).toBe(false);
        expect(shouldProxyPlaud("https://plaud.ai.evil.com/")).toBe(false);
        expect(shouldProxyPlaud("http://api.plaud.ai/")).toBe(false);
        expect(shouldProxyPlaud("not-a-url")).toBe(false);
    });

    it("skips resource.plaud.ai when PLAUD_PROXY_SCOPE=api-only", () => {
        mockEnv.PLAUD_PROXY_SCOPE = "api-only";
        expect(shouldProxyPlaud("https://api.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://api-euc1.plaud.ai/foo")).toBe(true);
        expect(shouldProxyPlaud("https://resource.plaud.ai/file.mp3")).toBe(
            false,
        );
    });
});

describe("plaudFetch without Webshare configured", () => {
    it("calls global fetch directly and never invokes wreq-js", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockWreq.fetch).not.toHaveBeenCalled();
        expect(isPlaudProxyConfigured()).toBe(false);
    });

    it("does not proxy non-Plaud URLs", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());
        await plaudFetch("https://example.com/x");
        expect(mockWreq.fetch).not.toHaveBeenCalled();
    });
});

describe("plaudFetch with Webshare configured", () => {
    beforeEach(() => {
        mockEnv.WEBSHARE_API_KEY = "test-key";
    });

    it("fetches the Webshare list via global fetch and routes the Plaud call through the proxy", async () => {
        mockFetch.mockResolvedValueOnce(webshareList([sampleProxy]));
        mockWreq.fetch.mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);

        // The Webshare list endpoint itself is not in the proxy scope.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [listUrl] = mockFetch.mock.calls[0];
        expect(String(listUrl)).toContain("proxy.webshare.io");

        expect(mockWreq.fetch).toHaveBeenCalledTimes(1);
        const [plaudUrl, opts] = mockWreq.fetch.mock.calls[0];
        expect(String(plaudUrl)).toBe(PLAUD_API_URL);
        expect(opts.proxy).toBe(
            `http://${sampleProxy.username}:${sampleProxy.password}@${sampleProxy.proxy_address}:${sampleProxy.port}`,
        );
        expect(typeof opts.browser).toBe("string");
        expect(opts.browser).toMatch(/^chrome_/);
        expect(opts.os).toBeDefined();
    });

    it("rotates exactly once on 403 and returns the second response", async () => {
        mockFetch.mockResolvedValueOnce(
            webshareList([sampleProxy, otherProxy]),
        );
        mockWreq.fetch
            .mockResolvedValueOnce(forbiddenResponse())
            .mockResolvedValueOnce(forbiddenResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(403);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockWreq.fetch).toHaveBeenCalledTimes(2);
    });

    it("returns a readable body when rotation is exhausted (no second proxy)", async () => {
        mockFetch.mockResolvedValueOnce(webshareList([sampleProxy]));
        mockWreq.fetch.mockResolvedValueOnce(forbiddenResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(403);
        const text = await res.text();
        expect(text).toContain("blocked");
    });

    it("returns the success response after a rotation succeeds", async () => {
        mockFetch.mockResolvedValueOnce(
            webshareList([sampleProxy, otherProxy]),
        );
        mockWreq.fetch
            .mockResolvedValueOnce(forbiddenResponse())
            .mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockWreq.fetch).toHaveBeenCalledTimes(2);
    });

    it("falls through to direct fetch when Webshare list is empty", async () => {
        mockFetch
            .mockResolvedValueOnce(webshareList([]))
            .mockResolvedValueOnce(okResponse());

        const res = await plaudFetch(PLAUD_API_URL);
        expect(res.status).toBe(200);
        expect(mockWreq.fetch).not.toHaveBeenCalled();
    });

    it("does not proxy non-Plaud URLs even when configured", async () => {
        mockFetch.mockResolvedValueOnce(okResponse());
        await plaudFetch("https://s3.amazonaws.com/some-bucket/file");
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockWreq.fetch).not.toHaveBeenCalled();
    });
});
