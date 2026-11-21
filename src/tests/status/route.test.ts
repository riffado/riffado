import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, partsMock } = vi.hoisted(() => ({
    envMock: { STATUS_TOKEN: undefined as string | undefined },
    partsMock: { getPartStatus: vi.fn() },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/status/parts", () => partsMock);

import { GET } from "@/app/api/status/[part]/route";
import type { StatusResponse } from "@/lib/status/types";

const TOKEN = "a".repeat(64);

function request(part: string, authorization?: string) {
    const headers = new Headers();
    if (authorization) headers.set("authorization", authorization);
    return {
        req: new Request(`https://riffado.com/api/status/${part}`, {
            headers,
        }),
        ctx: { params: Promise.resolve({ part }) },
    };
}

async function call(part: string, authorization?: string) {
    const { req, ctx } = request(part, authorization);
    return GET(req, ctx);
}

const OK_BODY: StatusResponse = {
    part: "sign-in",
    state: "ok",
    reason: "traffic-ok",
    latencyMs: 250,
    source: "traffic",
    window: { seconds: 300, requests: 40, errors: 0, p95Ms: 250 },
    checkedAt: "2026-11-18T10:00:00.000Z",
};

describe("GET /api/status/[part]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.STATUS_TOKEN = TOKEN;
        partsMock.getPartStatus.mockResolvedValue(OK_BODY);
    });

    it("404s when STATUS_TOKEN is unset, even with a token", async () => {
        envMock.STATUS_TOKEN = undefined;
        const res = await call("sign-in", `Bearer ${TOKEN}`);
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(partsMock.getPartStatus).not.toHaveBeenCalled();
    });

    it("401s without an Authorization header", async () => {
        const res = await call("sign-in");
        expect(res.status).toBe(401);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(partsMock.getPartStatus).not.toHaveBeenCalled();
    });

    it("401s on a wrong token", async () => {
        const res = await call("sign-in", `Bearer ${"b".repeat(64)}`);
        expect(res.status).toBe(401);
    });

    it("401s on a token prefix and on a non-Bearer scheme", async () => {
        expect((await call("sign-in", `Bearer ${TOKEN.slice(1)}`)).status).toBe(
            401,
        );
        expect((await call("sign-in", `Basic ${TOKEN}`)).status).toBe(401);
    });

    it("checks the token before revealing whether a part exists", async () => {
        const res = await call("no-such-part", "Bearer wrong");
        expect(res.status).toBe(401);
    });

    it("404s on an unknown part", async () => {
        const res = await call("no-such-part", `Bearer ${TOKEN}`);
        expect(res.status).toBe(404);
        expect(partsMock.getPartStatus).not.toHaveBeenCalled();
    });

    it("404s when the part does not apply to this instance", async () => {
        partsMock.getPartStatus.mockResolvedValue(null);
        const res = await call("payments", `Bearer ${TOKEN}`);
        expect(res.status).toBe(404);
        expect(partsMock.getPartStatus).toHaveBeenCalledWith("payments");
    });

    it("answers 200 with the status body and no-store", async () => {
        const res = await call("sign-in", `bearer ${TOKEN}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual(OK_BODY);
    });

    it("answers 200 for down states too (Kener reads the body)", async () => {
        partsMock.getPartStatus.mockResolvedValue({
            ...OK_BODY,
            state: "down",
            reason: "metrics-unavailable",
        });
        const res = await call("sign-in", `Bearer ${TOKEN}`);
        expect(res.status).toBe(200);
        expect((await res.json()).state).toBe("down");
    });

    it("answers 200 down with a numeric latency when the check throws", async () => {
        partsMock.getPartStatus.mockRejectedValue(new Error("boom"));
        const res = await call("plaud", `Bearer ${TOKEN}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            part: "plaud",
            state: "down",
            reason: "check-failed",
        });
        expect(typeof body.latencyMs).toBe("number");
    });
});
