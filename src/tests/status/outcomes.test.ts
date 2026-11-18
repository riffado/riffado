import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        WEBSHARE_API_KEY: undefined as string | undefined,
        PLAUD_PROXY_SCOPE: "all" as "all" | "api-only",
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import { plaudFetch } from "@/lib/plaud/fetch";
import {
    judgeAuthResponse,
    judgeMynahResponse,
    judgePlaudResponse,
    judgeSmtpSend,
    judgeStorageCall,
} from "@/lib/status/outcomes";
import {
    drainPending,
    resetStatusRecorderForTests,
    setStatusRecordingEnabled,
} from "@/lib/status/record";

const originalFetch = global.fetch;
const URL_ = "https://api.plaud.ai/file/simple/web?skip=0&limit=50";

function respond(status: number): Response {
    return new Response("{}", { status });
}

function recorded() {
    const { buckets } = drainPending();
    return {
        ok: buckets.reduce((n, b) => n + b.counts.ok, 0),
        err: buckets.reduce((n, b) => n + b.counts.err, 0),
    };
}

describe("plaud status recording (plaudFetch)", () => {
    beforeEach(() => {
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("does not count a 401 (the user's dead token) as an outage", async () => {
        global.fetch = vi.fn(async () => respond(401)) as typeof fetch;
        const res = await plaudFetch(URL_);
        expect(res.status).toBe(401);
        expect(recorded()).toEqual({ ok: 0, err: 0 });
    });

    it("counts 5xx, 429 and network failures as errors", async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce(respond(503))
            .mockResolvedValueOnce(respond(429))
            .mockRejectedValueOnce(
                new TypeError("fetch failed"),
            ) as typeof fetch;
        await plaudFetch(URL_);
        await plaudFetch(URL_);
        await expect(plaudFetch(URL_)).rejects.toThrow("fetch failed");
        expect(recorded()).toEqual({ ok: 0, err: 3 });
    });

    it("counts 2xx and other 4xx answers as Plaud working", async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce(respond(200))
            .mockResolvedValueOnce(respond(404)) as typeof fetch;
        await plaudFetch(URL_);
        await plaudFetch(URL_);
        expect(recorded()).toEqual({ ok: 2, err: 0 });
    });

    it("is a plain fetch while recording is off", async () => {
        setStatusRecordingEnabled(false);
        global.fetch = vi.fn(async () => respond(503)) as typeof fetch;
        const res = await plaudFetch(URL_);
        expect(res.status).toBe(503);
        expect(recorded()).toEqual({ ok: 0, err: 0 });
    });
});

describe("outcome judges", () => {
    const value = (status: number) => ({
        ok: true as const,
        value: respond(status),
    });
    const thrown = (error: unknown) => ({ ok: false as const, error });

    it("plaud: ignores 401 and our proxy's 407", () => {
        expect(judgePlaudResponse(value(401))).toBe("ignore");
        expect(judgePlaudResponse(value(407))).toBe("ignore");
        expect(judgePlaudResponse(value(502))).toBe("error");
        expect(judgePlaudResponse(value(403))).toBe("error");
        expect(judgePlaudResponse(value(400))).toBe("ok");
    });

    it("mynah: a refused service token is an outage, a rejected request is not", () => {
        expect(judgeMynahResponse(value(401))).toBe("error");
        expect(judgeMynahResponse(value(524))).toBe("error");
        expect(judgeMynahResponse(value(422))).toBe("ok");
        expect(judgeMynahResponse(thrown(new Error("x")))).toBe("error");
    });

    it("storage: a missing object is not an outage", () => {
        expect(
            judgeStorageCall(
                thrown(
                    new Error(
                        "Failed to download file from S3: NoSuchKey: The specified key does not exist.",
                    ),
                ),
            ),
        ).toBe("ok");
        expect(
            judgeStorageCall(
                thrown(
                    new Error("Failed to upload file to S3: socket hang up"),
                ),
            ),
        ).toBe("error");
    });

    it("smtp: a rejected recipient is not an outage", () => {
        expect(judgeSmtpSend(thrown({ command: "RCPT TO" }))).toBe("ok");
        expect(judgeSmtpSend(thrown({ code: "EENVELOPE" }))).toBe("ok");
        expect(judgeSmtpSend(thrown({ code: "EAUTH" }))).toBe("error");
    });

    it("sign-in: wrong passwords are fine, our rate limit is ignored, 5xx is an error", () => {
        expect(judgeAuthResponse(value(401))).toBe("ok");
        expect(judgeAuthResponse(value(429))).toBe("ignore");
        expect(judgeAuthResponse(value(500))).toBe("error");
    });
});
