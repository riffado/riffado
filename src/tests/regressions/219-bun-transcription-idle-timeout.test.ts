import { afterEach, describe, expect, it, vi } from "vitest";
import { elevenLabsTranscribe } from "@/lib/transcription/elevenlabs-transcribe";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";
import { createTranscriptionClient } from "@/lib/transcription/openai-client";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("long-running transcription transport", () => {
    it("disables Bun's idle timeout for OpenAI-compatible transcription", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ text: "hello" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: "http://localhost:9876/v1",
            timeoutMs: 60 * 60 * 1000,
        });
        const result = await client.audio.transcriptions.create({
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            model: "whisper-1",
        });

        expect(result.text).toBe("hello");
        const providerCalls = fetchMock.mock.calls.filter(([input]) =>
            String(input).endsWith("/audio/transcriptions"),
        );
        expect(providerCalls).toHaveLength(1);
        expect(providerCalls[0]?.[1]).toMatchObject({
            timeout: false,
        });
        expect(providerCalls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    });

    it("does not resend an expensive transcription after a provider error", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response("provider unavailable", { status: 503 }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const client = createTranscriptionClient({
            apiKey: "test-key",
            baseURL: "http://localhost:9876/v1",
            timeoutMs: 60 * 60 * 1000,
        });
        await expect(
            client.audio.transcriptions.create({
                file: new File(["audio"], "sample.wav", {
                    type: "audio/wav",
                }),
                model: "whisper-1",
            }),
        ).rejects.toThrow();

        expect(
            fetchMock.mock.calls.filter(([input]) =>
                String(input).endsWith("/audio/transcriptions"),
            ),
        ).toHaveLength(1);
    });

    it("disables Bun's idle timeout for ElevenLabs transcription", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({ text: "hello", language_code: "eng" }),
                {
                    headers: { "content-type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await elevenLabsTranscribe({
            apiKey: "test-key",
            model: "scribe_v1",
            file: new File(["audio"], "sample.wav", { type: "audio/wav" }),
            diarize: false,
            timeoutMs: 60 * 60 * 1000,
        });

        expect(result.text).toBe("hello");
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            timeout: false,
        });
        expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    });

    it("disables Bun's idle timeout for Gemini transcription", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [{ content: { parts: [{ text: "hello" }] } }],
                }),
                { headers: { "content-type": "application/json" } },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await geminiTranscribe({
            apiKey: "test-key",
            model: "gemini-2.5-flash",
            audioBuffer: Buffer.from("audio"),
            contentType: "audio/mpeg",
            timeoutMs: 60 * 60 * 1000,
        });

        expect(result.text).toBe("hello");
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            timeout: false,
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        );
        expect(init.headers["x-goog-api-key"]).toBe("test-key");
        expect(JSON.parse(init.body)).toMatchObject({
            contents: [
                {
                    parts: [
                        { text: expect.any(String) },
                        {
                            inlineData: {
                                mimeType: "audio/mpeg",
                                data: "YXVkaW8=",
                            },
                        },
                    ],
                },
            ],
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});
