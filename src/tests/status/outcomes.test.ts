import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoSuchBucket, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        WEBSHARE_API_KEY: undefined as string | undefined,
        PLAUD_PROXY_SCOPE: "all" as "all" | "api-only",
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import { plaudFetch } from "@/lib/plaud/fetch";
import { _resetPlaudProxyCacheForTest } from "@/lib/plaud/proxy";
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
import { withStorageTiming } from "@/lib/status/storage";
import { StorageRootMissingError } from "@/lib/storage/errors";
import { LocalStorage } from "@/lib/storage/local-storage";
import { S3Storage } from "@/lib/storage/s3-storage";

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

    it("counts a 403 from a Plaud API host as an error", async () => {
        global.fetch = vi.fn(async () => respond(403)) as typeof fetch;
        await plaudFetch(URL_);
        await plaudFetch("https://api-euc1.plaud.ai/file/detail/abc");
        await plaudFetch("https://api.plaud.cn/user/me");
        expect(recorded()).toEqual({ ok: 0, err: 3 });
    });

    it("ignores a 403 from a presigned storage host (expired content link)", async () => {
        global.fetch = vi.fn(async () => respond(403)) as typeof fetch;
        await plaudFetch(
            "https://plaud-prod.s3.amazonaws.com/transcript.json?X-Amz-Signature=abc",
        );
        await plaudFetch("https://resource.plaud.ai/audio.opus?sig=abc");
        expect(recorded()).toEqual({ ok: 0, err: 0 });
    });

    it("counts a 403 that is still the answer after proxy rotation", async () => {
        envMock.WEBSHARE_API_KEY = "test-key";
        _resetPlaudProxyCacheForTest();
        const proxy = (id: string) => ({
            id,
            username: "u",
            password: "p",
            proxy_address: "1.2.3.4",
            port: 8080,
            valid: true,
        });
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ results: [proxy("p1"), proxy("p2")] }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(respond(403))
            .mockResolvedValueOnce(respond(403)) as typeof fetch;
        try {
            const res = await plaudFetch(URL_);
            expect(res.status).toBe(403);
        } finally {
            envMock.WEBSHARE_API_KEY = undefined;
            _resetPlaudProxyCacheForTest();
        }
        expect(recorded()).toEqual({ ok: 0, err: 1 });
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
        const direct = { url: URL_ };
        expect(judgePlaudResponse(value(401), direct)).toBe("ignore");
        expect(judgePlaudResponse(value(407), direct)).toBe("ignore");
        expect(judgePlaudResponse(value(502), direct)).toBe("error");
        expect(judgePlaudResponse(value(403), direct)).toBe("error");
        expect(judgePlaudResponse(value(400), direct)).toBe("ok");
    });

    it("plaud: a 403 counts only from a Plaud API host", () => {
        expect(judgePlaudResponse(value(403), { url: URL_ })).toBe("error");
        expect(
            judgePlaudResponse(value(403), {
                url: "https://api.plaud.ai.evil.com/x",
            }),
        ).toBe("ignore");
        expect(
            judgePlaudResponse(value(503), {
                url: "https://plaud-prod.s3.amazonaws.com/x",
            }),
        ).toBe("error");
    });

    it("mynah: a refused service token is an outage, a rejected request is not", () => {
        expect(judgeMynahResponse(value(401))).toBe("error");
        expect(judgeMynahResponse(value(524))).toBe("error");
        expect(judgeMynahResponse(value(422))).toBe("ok");
        expect(judgeMynahResponse(thrown(new Error("x")))).toBe("error");
    });

    it("storage: a missing object is not an outage", () => {
        expect(
            judgeStorageCall("key")(
                thrown(
                    new Error(
                        "Failed to download file from S3: The specified key does not exist.",
                        {
                            cause: new NoSuchKey({
                                message: "The specified key does not exist.",
                                $metadata: { httpStatusCode: 404 },
                            }),
                        },
                    ),
                ),
            ),
        ).toBe("ignore");
        expect(
            judgeStorageCall("key")(
                thrown(
                    new Error("Failed to upload file to S3: socket hang up"),
                ),
            ),
        ).toBe("error");
    });

    it("storage: a missing bucket is an outage even though its message says 'does not exist'", () => {
        const missingBucket = new Error(
            "Failed to download file from S3: The specified bucket does not exist",
            {
                cause: new NoSuchBucket({
                    message: "The specified bucket does not exist",
                    $metadata: { httpStatusCode: 404 },
                }),
            },
        );
        expect(judgeStorageCall("key")(thrown(missingBucket))).toBe("error");
        expect(
            judgeStorageCall("write")(
                thrown(
                    Object.assign(new Error("Not Found"), {
                        $metadata: { httpStatusCode: 404 },
                    }),
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

describe("storage status recording (real adapters)", () => {
    beforeEach(() => {
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function s3() {
        return withStorageTiming(
            new S3Storage({
                bucket: "riffado-test",
                region: "us-east-1",
                accessKeyId: "test",
                secretAccessKey: "test",
            }),
        );
    }

    it("s3: a missing key is ignored, a missing bucket is an error", async () => {
        const send = vi.spyOn(S3Client.prototype, "send");
        send.mockRejectedValueOnce(
            new NoSuchKey({
                message: "The specified key does not exist.",
                $metadata: { httpStatusCode: 404 },
            }),
        );
        await expect(s3().downloadFile("a.opus")).rejects.toThrow(
            "does not exist",
        );
        expect(recorded()).toEqual({ ok: 0, err: 0 });

        send.mockRejectedValueOnce(
            new NoSuchBucket({
                message: "The specified bucket does not exist",
                $metadata: { httpStatusCode: 404 },
            }),
        );
        await expect(s3().downloadFile("a.opus")).rejects.toThrow(
            "does not exist",
        );
        expect(recorded()).toEqual({ ok: 0, err: 1 });

        send.mockRejectedValueOnce(
            new NoSuchBucket({
                message: "The specified bucket does not exist",
                $metadata: { httpStatusCode: 404 },
            }),
        );
        await expect(
            s3().uploadFile("a.opus", Buffer.from("x"), "audio/ogg"),
        ).rejects.toThrow("does not exist");
        expect(recorded()).toEqual({ ok: 0, err: 1 });
    });

    describe("local", () => {
        let dir: string;

        beforeEach(async () => {
            dir = await mkdtemp(join(tmpdir(), "riffado-status-storage-"));
        });

        afterEach(async () => {
            await rm(dir, { recursive: true, force: true });
        });

        it("ignores a missing key and a rejected key", async () => {
            const storage = withStorageTiming(new LocalStorage(dir));
            await expect(storage.downloadFile("missing.opus")).rejects.toThrow(
                "ENOENT",
            );
            await expect(
                storage.downloadStream("missing.opus"),
            ).rejects.toThrow("ENOENT");
            await expect(storage.exists("missing.opus")).resolves.toBe(false);
            await expect(storage.downloadFile("../escape")).rejects.toThrow(
                "path traversal",
            );
            expect(recorded()).toEqual({ ok: 1, err: 0 });
        });

        it("counts a missing base directory (unmounted volume) as an error", async () => {
            const storage = withStorageTiming(
                new LocalStorage(join(dir, "unmounted")),
            );
            await expect(storage.downloadFile("a.opus")).rejects.toThrow(
                "ENOENT",
            );
            await expect(
                storage.downloadStream("a.opus"),
            ).rejects.toBeInstanceOf(StorageRootMissingError);
            await expect(storage.exists("a.opus")).rejects.toBeInstanceOf(
                StorageRootMissingError,
            );
            await expect(storage.deleteFile("a.opus")).rejects.toThrow(
                "ENOENT",
            );
            expect(recorded()).toEqual({ ok: 0, err: 4 });
        });
    });
});
