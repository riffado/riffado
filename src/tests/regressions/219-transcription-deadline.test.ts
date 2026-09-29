import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchTranscription } from "@/lib/transcription/fetch";
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
    it("aborts a provider that never sends response headers", async () => {
        const url = await serve((request) => request.resume());

        await expect(fetchTranscription(url, {}, 100)).rejects.toThrow();
    });

    it("keeps the deadline active after response headers arrive", async () => {
        const url = await serve((_request, response) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"text":');
        });

        const response = await fetchTranscription(url, {}, 200);
        expect(response.status).toBe(200);
        await expect(response.json()).rejects.toThrow();
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
        await expect(response.json()).rejects.toThrow();
    });

    it("preserves cancellation embedded in a Request", async () => {
        const url = await serve((_request, response) => response.end("ok"));
        const controller = new AbortController();
        const request = new Request(url, { signal: controller.signal });
        controller.abort();

        await expect(fetchTranscription(request, {}, 2000)).rejects.toThrow();
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
        ).rejects.toThrow();
        expect(transcriptionRequests).toBe(1);
    });
});
