import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, tokenMock } = vi.hoisted(() => ({
    queriesMock: {
        confirmSubscriber: vi.fn(),
        getSubscriberById: vi.fn(),
    },
    tokenMock: {
        verifyUnsubscribeToken: vi.fn(),
    },
}));

vi.mock("@/db/queries/newsletter-subscriptions", () => queriesMock);
vi.mock("@/lib/email/unsubscribe-token", () => tokenMock);

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/newsletter/confirm/route";

function getRequest(params: Record<string, string>) {
    const url = new URL("https://riffado.com/api/newsletter/confirm");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new NextRequest(url);
}

function postRequest(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    return new Request("https://riffado.com/api/newsletter/confirm", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    }) as unknown as Parameters<typeof POST>[0];
}

describe("GET /api/newsletter/confirm", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tokenMock.verifyUnsubscribeToken.mockReturnValue(true);
        queriesMock.getSubscriberById.mockResolvedValue({ id: "sub_1" });
    });

    it("does not confirm the subscriber -- renders a page requiring a POST instead", async () => {
        const res = await GET(getRequest({ s: "sub_1", t: "tok" }));
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('method="post"');
        expect(queriesMock.confirmSubscriber).not.toHaveBeenCalled();
    });

    it("rejects an invalid token without confirming", async () => {
        tokenMock.verifyUnsubscribeToken.mockReturnValue(false);
        const res = await GET(getRequest({ s: "sub_1", t: "bad" }));
        expect(res.status).toBe(400);
        expect(queriesMock.confirmSubscriber).not.toHaveBeenCalled();
    });
});

describe("POST /api/newsletter/confirm", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tokenMock.verifyUnsubscribeToken.mockReturnValue(true);
        queriesMock.getSubscriberById.mockResolvedValue({ id: "sub_1" });
        queriesMock.confirmSubscriber.mockResolvedValue(true);
    });

    it("confirms the subscriber on a valid user-initiated POST", async () => {
        const res = await POST(postRequest({ s: "sub_1", t: "tok" }));
        expect(res.status).toBe(200);
        expect(queriesMock.confirmSubscriber).toHaveBeenCalledWith("sub_1");
    });

    it("rejects an invalid token without confirming", async () => {
        tokenMock.verifyUnsubscribeToken.mockReturnValue(false);
        const res = await POST(postRequest({ s: "sub_1", t: "bad" }));
        expect(res.status).toBe(400);
        expect(queriesMock.confirmSubscriber).not.toHaveBeenCalled();
    });
});
