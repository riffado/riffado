import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTranscription } from "@/lib/transcription/fetch";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";
import { createTranscriptionClient } from "@/lib/transcription/openai-client";

const servers: Server[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];

async function serve(handler: RequestListener): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Expected a TCP server address");
    }
    return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
    vi.unstubAllGlobals();
    for (const timer of timers.splice(0)) clearTimeout(timer);
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise<void>((resolve, reject) => {
                    server.closeAllConnections();
                    server.close((error) =>
                        error ? reject(error) : resolve(),
                    );
                }),
        ),
    );
});

describe("transcription request deadlines over HTTP", () => {
    it("preserves a Gemini deadline after receiving an incomplete HTTP error", async () => {
        const url = await serve((request, response) => {
            request.resume();
            response.writeHead(503, { "content-type": "application/json" });
            response.write('{"error":');
        });
        const nativeFetch = globalThis.fetch;
        let receivedErrorResponse = false;
        vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit) => {
            const response = await nativeFetch(url, init);
            receivedErrorResponse = response.status === 503;
            return response;
        });

        await expect(
            geminiTranscribe({
                apiKey: "test-key",
                model: "gemini-2.5-flash",
                audioBuffer: Buffer.from("audio"),
                contentType: "audio/mpeg",
                timeoutMs: 500,
            }),
        ).rejects.toMatchObject({ name: "TimeoutError" });
        expect(receivedErrorResponse).toBe(true);
    });

    it("aborts a provider that never sends response headers", async () => {
        const url = await serve((request) => request.resume());

        await expect(fetchTranscription(url, {}, 100)).rejects.toMatchObject({
            name: "TimeoutError",
        });
    });

    it("keeps the deadline active after response headers arrive", async () => {
        const url = await serve((_request, response) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"text":');
        });

        const response = await fetchTranscription(url, {}, 200);
        expect(response.status).toBe(200);
        await expect(response.json()).rejects.toMatchObject({
            name: "TimeoutError",
        });
    });

    it("allows a delayed complete body within the deadline", async () => {
        const url = await serve((_request, response) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"text":');
            timers.push(setTimeout(() => response.end('"hello"}'), 50));
        });

        const response = await fetchTranscription(url, {}, 2000);
        await expect(response.json()).resolves.toEqual({ text: "hello" });
    });

    it("preserves caller cancellation while consuming the body", async () => {
        const url = await serve((_request, response) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"text":');
        });
        const controller = new AbortController();
        const response = await fetchTranscription(
            url,
            { signal: controller.signal },
            2000,
        );

        controller.abort();
        await expect(response.json()).rejects.toMatchObject({
            name: "AbortError",
        });
    });

    it("preserves cancellation embedded in a Request", async () => {
        const url = await serve((_request, response) => response.end("ok"));
        const controller = new AbortController();
        const request = new Request(url, { signal: controller.signal });
        controller.abort();

        await expect(
            fetchTranscription(request, {}, 2000),
        ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("aborts an OpenAI-compatible response body without resending audio", async () => {
        let transcriptionRequests = 0;
        const url = await serve((request, response) => {
            request.resume();
            if (request.url !== "/v1/audio/transcriptions") {
                response.writeHead(404).end();
                return;
            }
            transcriptionRequests += 1;
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"text":');
        });
        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: `${url}/v1`,
            timeoutMs: 200,
        });

        await expect(
            client.audio.transcriptions.create({
                file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
                model: "whisper-1",
            }),
        ).rejects.toMatchObject({ name: "TimeoutError" });
        expect(transcriptionRequests).toBe(1);
    });
});
