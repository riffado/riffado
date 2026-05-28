/**
 * Regression tests for the runtime contract of the Rybbit analytics
 * proxy route handlers. There have been two distinct 404 regressions
 * on these endpoints, both surfaced as 404 at `riffado.com` despite
 * `IS_HOSTED` + `RYBBIT_HOST` + `RYBBIT_SITE_ID` being set:
 *
 *   1. Original (#127): the proxy lived in `next.config.ts` as a
 *      `rewrites()` entry. Rewrites are baked at `next build`; the
 *      published Docker image is built generically without those env
 *      vars, so the rewrite list shipped empty and `/api/_int/*` 404'd
 *      at runtime. Fixed by moving the proxy to runtime route handlers
 *      that read `env` at request time.
 *
 *   2. Private-folder (PR introducing this file's rename): the route
 *      folder was named `_int`. App Router treats any folder prefixed
 *      with `_` as a private folder and excludes it from the route
 *      manifest, so every `/api/_int/*` path silently 404'd via the
 *      prerendered App Router not-found page. This suite did not catch
 *      it because the tests import the route module directly and
 *      bypass the router. Fixed by renaming the folder to `int/`; the
 *      `rybbit-int-route-reachable.test.ts` companion test guards the
 *      class of bug.
 *
 * This file verifies the per-handler runtime contract once the URL is
 * reachable:
 *   - unconfigured (RYBBIT_HOST or RYBBIT_SITE_ID missing) -> 404
 *   - configured -> proxies to ${RYBBIT_HOST}/api/{script.js,track,identify}
 *     with body forwarded and (for events) client IP / UA preserved.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

// Mocked env module read by the route handlers. We mutate `mockEnv` per
// test and the handlers see the updated values because they reference
// `env.RYBBIT_HOST` etc. at request time, not at import time.
const mockEnv: {
    IS_HOSTED?: boolean;
    RYBBIT_HOST?: string;
    RYBBIT_SITE_ID?: string;
} = {};

vi.mock("@/lib/env", () => ({
    get env() {
        return mockEnv;
    },
}));

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
    originalFetch = globalThis.fetch;
});

afterAll(() => {
    globalThis.fetch = originalFetch;
});

afterEach(() => {
    mockEnv.IS_HOSTED = undefined;
    mockEnv.RYBBIT_HOST = undefined;
    mockEnv.RYBBIT_SITE_ID = undefined;
    // Restore per-test, not just per-file: Vitest workers can execute
    // multiple test files in the same process and a leaked `fetch` mock
    // would cause order-dependent failures elsewhere.
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

function installFetchMock(response: Response) {
    fetchMock = vi.fn().mockResolvedValue(response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
}

// `script.js` path is load-bearing: the Rybbit client splits its own
// `src` on `/script.js` to derive `analyticsHost`. Serving from a
// different path silently breaks event delivery.
describe("Rybbit proxy: /api/int/script.js", () => {
    function getReq() {
        return new Request("https://app.example.com/api/int/script.js");
    }

    it("returns 404 when IS_HOSTED is false (self-host)", async () => {
        // Even if a self-hoster happens to set RYBBIT_*, the proxy stays
        // off unless IS_HOSTED=true, matching <RybbitAnalytics>'s gate.
        mockEnv.IS_HOSTED = false;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { GET } = await import("@/app/api/int/script.js/route");
        const res = await GET(getReq());
        expect(res.status).toBe(404);
    });

    it("returns 404 when RYBBIT_HOST is missing", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { GET } = await import("@/app/api/int/script.js/route");
        const res = await GET(getReq());
        expect(res.status).toBe(404);
    });

    it("returns 404 when RYBBIT_SITE_ID is missing", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        const { GET } = await import("@/app/api/int/script.js/route");
        const res = await GET(getReq());
        expect(res.status).toBe(404);
    });

    it("proxies to RYBBIT_HOST/api/script.js when configured", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(
            new Response("/* rybbit script */", {
                status: 200,
                headers: { "content-type": "application/javascript" },
            }),
        );

        const { GET } = await import("@/app/api/int/script.js/route");
        const res = await GET(getReq());

        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/script.js",
            expect.objectContaining({ cache: "no-store", method: "GET" }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain(
            "application/javascript",
        );
        expect(await res.text()).toBe("/* rybbit script */");
    });

    it("strips trailing slash from RYBBIT_HOST", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com/";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("ok", { status: 200 }));

        const { GET } = await import("@/app/api/int/script.js/route");
        await GET(getReq());

        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/script.js",
            expect.anything(),
        );
    });

    it("returns 502 when upstream fails", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("nope", { status: 500 }));

        const { GET } = await import("@/app/api/int/script.js/route");
        const res = await GET(getReq());
        expect(res.status).toBe(502);
    });
});

describe("Rybbit proxy: /api/int/track", () => {
    it("returns 404 when unconfigured", async () => {
        const { POST } = await import("@/app/api/int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/int/track", {
                method: "POST",
                body: JSON.stringify({ event: "pageview" }),
            }),
        );
        expect(res.status).toBe(404);
    });

    it("returns 404 when IS_HOSTED is false even if RYBBIT_* are set", async () => {
        mockEnv.IS_HOSTED = false;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        const { POST } = await import("@/app/api/int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/int/track", {
                method: "POST",
                body: "{}",
            }),
        );
        expect(res.status).toBe(404);
    });

    it("forwards body, content-type, UA, and X-Forwarded-For", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const payload = JSON.stringify({ event: "pageview", path: "/" });
        const { POST } = await import("@/app/api/int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/int/track", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "user-agent": "Mozilla/5.0 test",
                    "x-forwarded-for": "203.0.113.7",
                    // Auth cookies must NOT be forwarded to the analytics
                    // backend - same-origin pages send them automatically.
                    cookie: "session=secret",
                    authorization: "Bearer secret",
                },
                body: payload,
            }),
        );

        expect(res.status).toBe(202);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://rybbit.example.com/api/track");
        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("user-agent")).toBe("Mozilla/5.0 test");
        expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
        expect(headers.get("cookie")).toBeNull();
        expect(headers.get("authorization")).toBeNull();
        const body = init.body as ArrayBuffer;
        expect(new TextDecoder().decode(body)).toBe(payload);
    });

    it("falls back to X-Real-IP when X-Forwarded-For is absent", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const { POST } = await import("@/app/api/int/track/route");
        await POST(
            new Request("https://app.example.com/api/int/track", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-real-ip": "203.0.113.9",
                },
                body: "{}",
            }),
        );

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        const headers = new Headers(init.headers);
        expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    });

    it("returns 502 when upstream fetch throws", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const { POST } = await import("@/app/api/int/track/route");
        const res = await POST(
            new Request("https://app.example.com/api/int/track", {
                method: "POST",
                body: "{}",
            }),
        );
        expect(res.status).toBe(502);
    });
});

describe("Rybbit proxy: /api/int/identify", () => {
    it("proxies to RYBBIT_HOST/api/identify", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const { POST } = await import("@/app/api/int/identify/route");
        const res = await POST(
            new Request("https://app.example.com/api/int/identify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ userId: "u_1" }),
            }),
        );

        expect(res.status).toBe(202);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/identify",
            expect.objectContaining({ method: "POST" }),
        );
    });
});

// The Rybbit client fetches `/api/site/tracking-config/:siteId` at
// startup. Before this route existed it 404'd in the console and
// session replay / web vitals silently defaulted off.
describe("Rybbit proxy: /api/int/site/tracking-config/:siteId", () => {
    it("returns 404 when unconfigured", async () => {
        const { GET } = await import(
            "@/app/api/int/site/tracking-config/[siteId]/route"
        );
        const res = await GET(
            new Request(
                "https://app.example.com/api/int/site/tracking-config/site-1",
            ),
            { params: Promise.resolve({ siteId: "site-1" }) },
        );
        expect(res.status).toBe(404);
    });

    it("proxies to RYBBIT_HOST/api/site/tracking-config/:siteId", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(
            new Response(JSON.stringify({ sessionReplay: false }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );

        const { GET } = await import(
            "@/app/api/int/site/tracking-config/[siteId]/route"
        );
        const res = await GET(
            new Request(
                "https://app.example.com/api/int/site/tracking-config/site-1",
            ),
            { params: Promise.resolve({ siteId: "site-1" }) },
        );

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/site/tracking-config/site-1",
            expect.objectContaining({ method: "GET" }),
        );
    });

    it("URL-encodes the siteId path segment", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 200 }));

        const { GET } = await import(
            "@/app/api/int/site/tracking-config/[siteId]/route"
        );
        await GET(
            new Request(
                "https://app.example.com/api/int/site/tracking-config/weird%20id",
            ),
            { params: Promise.resolve({ siteId: "weird id" }) },
        );

        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toBe(
            "https://rybbit.example.com/api/site/tracking-config/weird%20id",
        );
    });
});

describe("Rybbit proxy: /api/int/replay.js", () => {
    it("proxies to RYBBIT_HOST/api/replay.js when configured", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(
            new Response("/* replay */", {
                status: 200,
                headers: { "content-type": "application/javascript" },
            }),
        );

        const { GET } = await import("@/app/api/int/replay.js/route");
        const res = await GET(
            new Request("https://app.example.com/api/int/replay.js"),
        );

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://rybbit.example.com/api/replay.js",
            expect.objectContaining({ method: "GET" }),
        );
    });

    it("returns 404 when unconfigured", async () => {
        const { GET } = await import("@/app/api/int/replay.js/route");
        const res = await GET(
            new Request("https://app.example.com/api/int/replay.js"),
        );
        expect(res.status).toBe(404);
    });
});

describe("Rybbit proxy: /api/int/session-replay/record/:siteId", () => {
    it("returns 404 when unconfigured", async () => {
        const { POST } = await import(
            "@/app/api/int/session-replay/record/[siteId]/route"
        );
        const res = await POST(
            new Request(
                "https://app.example.com/api/int/session-replay/record/site-1",
                { method: "POST", body: "[]" },
            ),
            { params: Promise.resolve({ siteId: "site-1" }) },
        );
        expect(res.status).toBe(404);
    });

    it("forwards body and XFF to RYBBIT_HOST/api/session-replay/record/:siteId", async () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.RYBBIT_HOST = "https://rybbit.example.com";
        mockEnv.RYBBIT_SITE_ID = "site-1";
        installFetchMock(new Response("{}", { status: 202 }));

        const payload = JSON.stringify([{ type: 2, data: {} }]);
        const { POST } = await import(
            "@/app/api/int/session-replay/record/[siteId]/route"
        );
        const res = await POST(
            new Request(
                "https://app.example.com/api/int/session-replay/record/site-1",
                {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "user-agent": "Mozilla/5.0 test",
                        "x-forwarded-for": "203.0.113.7",
                        cookie: "session=secret",
                        authorization: "Bearer secret",
                    },
                    body: payload,
                },
            ),
            { params: Promise.resolve({ siteId: "site-1" }) },
        );

        expect(res.status).toBe(202);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(
            "https://rybbit.example.com/api/session-replay/record/site-1",
        );
        const headers = new Headers(init.headers);
        expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
        expect(headers.get("user-agent")).toBe("Mozilla/5.0 test");
        expect(headers.get("cookie")).toBeNull();
        expect(headers.get("authorization")).toBeNull();
        const body = init.body as ArrayBuffer;
        expect(new TextDecoder().decode(body)).toBe(payload);
    });
});
