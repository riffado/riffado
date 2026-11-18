import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elevenLabsTranscribe } from "@/lib/transcription/elevenlabs-transcribe";
import { fetchTranscription } from "@/lib/transcription/fetch";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";
import { createTranscriptionClient } from "@/lib/transcription/openai-client";

const URL_UNDER_TEST = "https://provider.test/v1/audio/transcriptions";
const TIMEOUT_MS = 60 * 60 * 1000;
const POST = { method: "POST", body: "audio" };

function rateLimited(retryAfter?: string): Response {
    return new Response("slow down", {
        status: 429,
        headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
    });
}

function ok(): Response {
    return new Response(JSON.stringify({ text: "hello" }), {
        headers: { "content-type": "application/json" },
    });
}

function nodeConnectionError(code: string): TypeError {
    return new TypeError("fetch failed", {
        cause: Object.assign(new Error(`connect ${code}`), { code }),
    });
}

function bunConnectionError(code: string): TypeError {
    return Object.assign(new TypeError("Unable to connect"), { code });
}

function stubFetch(...outcomes: (Response | Error)[]) {
    const fetchMock = vi.fn();
    for (const outcome of outcomes) {
        if (outcome instanceof Error) {
            fetchMock.mockRejectedValueOnce(outcome);
        } else {
            fetchMock.mockResolvedValueOnce(outcome);
        }
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("fetchTranscription retries HTTP 429", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("retries a 429 and returns the next response", async () => {
        const fetchMock = stubFetch(rateLimited(), ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.runAllTimersAsync();

        expect((await pending).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries at most twice and then returns the 429", async () => {
        const fetchMock = stubFetch(
            rateLimited(),
            rateLimited(),
            rateLimited(),
            ok(),
        );

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.runAllTimersAsync();

        expect((await pending).status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("backs off 1s then 2s without Retry-After", async () => {
        const fetchMock = stubFetch(rateLimited(), rateLimited(), ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        expect((await pending).status).toBe(200);
    });

    it("honours Retry-After in seconds", async () => {
        const fetchMock = stubFetch(rateLimited("7"), ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(6999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        expect((await pending).status).toBe(200);
    });

    it("honours Retry-After as an HTTP date", async () => {
        vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"));
        const fetchMock = stubFetch(
            rateLimited(new Date("2026-11-18T10:00:05.000Z").toUTCString()),
            ok(),
        );

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(4999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        expect((await pending).status).toBe(200);
    });

    it.each([
        ["seconds", "120"],
        ["an HTTP date", new Date("2026-11-18T10:05:00.000Z").toUTCString()],
    ])("caps Retry-After given as %s at 30s", async (_kind, header) => {
        vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"));
        const fetchMock = stubFetch(rateLimited(header), ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        expect((await pending).status).toBe(200);
    });

    it("retries immediately when the Retry-After date has passed", async () => {
        vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"));
        const fetchMock = stubFetch(
            rateLimited(new Date("2026-11-18T09:59:00.000Z").toUTCString()),
            ok(),
        );

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(0);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect((await pending).status).toBe(200);
    });

    it.each([
        "soon",
        "-5",
    ])("falls back to backoff for an invalid Retry-After (%s)", async (header) => {
        const fetchMock = stubFetch(rateLimited(header), ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        expect((await pending).status).toBe(200);
    });

    it("re-sends the same request body on retry", async () => {
        const form = new FormData();
        form.append("file", new Blob(["audio"]), "sample.wav");
        const fetchMock = stubFetch(rateLimited(), ok());

        const pending = fetchTranscription(
            URL_UNDER_TEST,
            { method: "POST", body: form },
            TIMEOUT_MS,
        );
        await vi.runAllTimersAsync();
        await pending;

        expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(form);
    });
});

describe("fetchTranscription retries connection errors raised before a response", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it.each([
        ["Node", nodeConnectionError("ECONNREFUSED")],
        ["Node", nodeConnectionError("ECONNRESET")],
        ["Node", nodeConnectionError("ENOTFOUND")],
        ["Node", nodeConnectionError("UND_ERR_SOCKET")],
        [
            "Node",
            new TypeError("fetch failed", {
                cause: Object.assign(new AggregateError([]), {
                    code: "ECONNREFUSED",
                }),
            }),
        ],
        ["Bun", bunConnectionError("ConnectionRefused")],
        ["Bun", bunConnectionError("ECONNRESET")],
        ["Bun", bunConnectionError("ENOTFOUND")],
    ])("retries a %s connection error %#", async (_runtime, error) => {
        const fetchMock = stubFetch(error, ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        expect((await pending).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("backs off 1s then 2s and rethrows after two retries", async () => {
        const error = nodeConnectionError("ECONNREFUSED");
        const fetchMock = stubFetch(error, error, error, ok());

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        const assertion = expect(pending).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe("fetchTranscription limits socket-closed retries to fast failures", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    function failAfter(ms: number, error: Error) {
        return async () => {
            vi.setSystemTime(Date.now() + ms);
            throw error;
        };
    }

    it.each([
        ["Node", nodeConnectionError("ECONNRESET")],
        ["Node", nodeConnectionError("UND_ERR_SOCKET")],
        ["Bun", bunConnectionError("ECONNRESET")],
    ])("does not retry a %s socket closed after 5s %#", async (_runtime, error) => {
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(failAfter(5000, error))
            .mockResolvedValueOnce(ok());
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS),
        ).rejects.toBe(error);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries a socket closed within 5s", async () => {
        const error = nodeConnectionError("ECONNRESET");
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(failAfter(4999, error))
            .mockResolvedValueOnce(ok());
        vi.stubGlobal("fetch", fetchMock);

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(1000);

        expect((await pending).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries a refused connection however long it took", async () => {
        const error = nodeConnectionError("ECONNREFUSED");
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(failAfter(60_000, error))
            .mockResolvedValueOnce(ok());
        vi.stubGlobal("fetch", fetchMock);

        const pending = fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(1000);

        expect((await pending).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("fetchTranscription does not retry other failures", () => {
    it.each([
        500, 502, 503, 504, 524,
    ])("returns HTTP %i without retrying", async (status) => {
        const fetchMock = stubFetch(
            new Response("down", {
                status,
                headers: { "retry-after": "0" },
            }),
            ok(),
        );

        const response = await fetchTranscription(
            URL_UNDER_TEST,
            POST,
            TIMEOUT_MS,
        );

        expect(response.status).toBe(status);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        400, 401, 403, 404, 408, 413, 422,
    ])("returns HTTP %i without retrying", async (status) => {
        const fetchMock = stubFetch(new Response("no", { status }), ok());

        const response = await fetchTranscription(
            URL_UNDER_TEST,
            POST,
            TIMEOUT_MS,
        );

        expect(response.status).toBe(status);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["a deadline", new DOMException("timed out", "TimeoutError")],
        ["an abort", new DOMException("aborted", "AbortError")],
        [
            "a connect timeout",
            new TypeError("fetch failed", {
                cause: Object.assign(new Error("Connect Timeout Error"), {
                    code: "UND_ERR_CONNECT_TIMEOUT",
                }),
            }),
        ],
        ["an error without a code", new TypeError("fetch failed")],
        ["a non-network error", new Error("boom")],
    ])("rethrows %s without retrying", async (_kind, error) => {
        const fetchMock = stubFetch(error, ok());

        await expect(
            fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS),
        ).rejects.toBe(error);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry when retry is disabled", async () => {
        const fetchMock = stubFetch(rateLimited("0"), ok());

        const response = await fetchTranscription(
            URL_UNDER_TEST,
            POST,
            TIMEOUT_MS,
            { retry: false },
        );

        expect(response.status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const error = nodeConnectionError("ECONNREFUSED");
        stubFetch(error, ok());
        await expect(
            fetchTranscription(URL_UNDER_TEST, POST, TIMEOUT_MS, {
                retry: false,
            }),
        ).rejects.toBe(error);
    });

    it("does not retry a streamed body that cannot be replayed", async () => {
        const fetchMock = stubFetch(rateLimited("0"), ok());

        const response = await fetchTranscription(
            URL_UNDER_TEST,
            { method: "POST", body: new Blob(["audio"]).stream() },
            TIMEOUT_MS,
        );

        expect(response.status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry a Request carrying its own body", async () => {
        const fetchMock = stubFetch(rateLimited("0"), ok());

        const response = await fetchTranscription(
            new Request(URL_UNDER_TEST, { method: "POST", body: "audio" }),
            {},
            TIMEOUT_MS,
        );

        expect(response.status).toBe(429);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops waiting when the caller aborts during backoff", async () => {
        const fetchMock = stubFetch(rateLimited("10"), ok());
        const controller = new AbortController();

        const pending = fetchTranscription(
            URL_UNDER_TEST,
            { ...POST, signal: controller.signal },
            TIMEOUT_MS,
        );
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops waiting when the deadline expires during backoff", async () => {
        const fetchMock = stubFetch(rateLimited("10"), ok());

        await expect(
            fetchTranscription(URL_UNDER_TEST, POST, 100),
        ).rejects.toMatchObject({ name: "TimeoutError" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("fetchTranscription retries over real HTTP", () => {
    const servers: { close: (cb: () => void) => unknown }[] = [];

    afterEach(async () => {
        await Promise.all(
            servers
                .splice(0)
                .map(
                    (server) =>
                        new Promise<void>((resolve) =>
                            server.close(() => resolve()),
                        ),
                ),
        );
    });

    it("retries a socket reset before any response", async () => {
        let connections = 0;
        const server: Server = createNetServer((socket) => {
            connections += 1;
            if (connections === 1) {
                socket.resetAndDestroy();
                return;
            }
            socket.once("data", () => {
                socket.end(
                    "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok",
                );
            });
        });
        servers.push(server);
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = server.address() as { port: number };

        const response = await fetchTranscription(
            `http://127.0.0.1:${port}/`,
            POST,
            10_000,
        );

        expect(await response.text()).toBe("ok");
        expect(connections).toBe(2);
    });

    it("retries a real 429 honouring Retry-After: 0", async () => {
        let requests = 0;
        const server = createHttpServer((request, response) => {
            request.resume();
            requests += 1;
            if (requests === 1) {
                response.writeHead(429, { "retry-after": "0" });
                response.end("slow down");
                return;
            }
            response.end("ok");
        });
        servers.push(server);
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = server.address() as { port: number };

        const response = await fetchTranscription(
            `http://127.0.0.1:${port}/`,
            POST,
            10_000,
        );

        expect(await response.text()).toBe("ok");
        expect(requests).toBe(2);
    });
});

describe("transcription paths using the shared retry", () => {
    function providerCalls(fetchMock: ReturnType<typeof vi.fn>) {
        return fetchMock.mock.calls.filter(([input]) =>
            String(input).endsWith("/audio/transcriptions"),
        );
    }

    function stubProvider(...outcomes: (Response | Error)[]) {
        const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
            if (!String(input).endsWith("/audio/transcriptions")) {
                return new Response("");
            }
            const outcome = outcomes.shift() ?? ok();
            if (outcome instanceof Error) throw outcome;
            return outcome;
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("retries an OpenAI-compatible 429 once in the fetch layer", async () => {
        vi.useFakeTimers();
        const fetchMock = stubProvider(rateLimited(), ok());
        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: "https://provider.test/v1",
            timeoutMs: TIMEOUT_MS,
        });

        const pending = client.audio.transcriptions.create({
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            model: "whisper-1",
        });
        await vi.runAllTimersAsync();

        expect((await pending).text).toBe("hello");
        expect(providerCalls(fetchMock)).toHaveLength(2);
    });

    it("retries an OpenAI-compatible connection error before any response", async () => {
        vi.useFakeTimers();
        const fetchMock = stubProvider(
            nodeConnectionError("ECONNREFUSED"),
            ok(),
        );
        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: "https://provider.test/v1",
            timeoutMs: TIMEOUT_MS,
        });

        const pending = client.audio.transcriptions.create({
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            model: "whisper-1",
        });
        await vi.runAllTimersAsync();

        expect((await pending).text).toBe("hello");
        expect(providerCalls(fetchMock)).toHaveLength(2);
    });

    it("surfaces an OpenAI-compatible 429 after two retries", async () => {
        vi.useFakeTimers();
        const fetchMock = stubProvider(
            rateLimited(),
            rateLimited(),
            rateLimited(),
            rateLimited(),
        );
        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: "https://provider.test/v1",
            timeoutMs: TIMEOUT_MS,
        });

        const pending = client.audio.transcriptions.create({
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            model: "whisper-1",
        });
        const assertion = expect(pending).rejects.toMatchObject({
            status: 429,
        });
        await vi.runAllTimersAsync();
        await assertion;

        expect(providerCalls(fetchMock)).toHaveLength(3);
    });

    it("retries a Gemini 429", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch(
            rateLimited(),
            new Response(
                JSON.stringify({
                    candidates: [{ content: { parts: [{ text: "hello" }] } }],
                }),
                { headers: { "content-type": "application/json" } },
            ),
        );

        const pending = geminiTranscribe({
            apiKey: "test-key",
            model: "gemini-2.5-flash",
            audioBuffer: Buffer.from("audio"),
            contentType: "audio/mpeg",
            timeoutMs: TIMEOUT_MS,
        });
        await vi.runAllTimersAsync();

        expect((await pending).text).toBe("hello");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["a 429", () => rateLimited("0")],
        ["a connection error", () => nodeConnectionError("ECONNREFUSED")],
    ])("leaves ElevenLabs' own retry loop as the only retry for %s", async (_kind, outcome) => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(async () => {
            const result = outcome();
            if (result instanceof Error) throw result;
            return result;
        });
        vi.stubGlobal("fetch", fetchMock);

        const pending = elevenLabsTranscribe({
            apiKey: "test-key",
            model: "scribe_v1",
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            diarize: false,
            timeoutMs: TIMEOUT_MS,
        });
        const assertion = expect(pending).rejects.toThrow();
        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
