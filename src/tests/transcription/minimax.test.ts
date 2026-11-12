/**
 * MiniMax client — endpoint derivation, header/form split (language as
 * an HTTP header, not a form field) and error mapping (429/5xx/timeout
 * are retryable). Stubbed fetch, as in the existing provider tests —
 * no real network calls.
 */

import { describe, expect, it, vi } from "vitest";
import {
    buildMinimaxSpeechToTextUrl,
    isMiniMaxCredentials,
    MiniMaxTranscriptionError,
    transcribeMinimax,
} from "@/lib/transcription/minimax";

describe("buildMinimaxSpeechToTextUrl", () => {
    it("appends /v1/speech_to_text to the MiniMax default base URL", () => {
        expect(buildMinimaxSpeechToTextUrl("https://api.minimax.io/v1")).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
    });

    it("replaces everything from /v1 — never /audio/transcriptions, never /v1/v1", () => {
        expect(buildMinimaxSpeechToTextUrl("https://api.minimax.io/v1/")).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
        expect(
            buildMinimaxSpeechToTextUrl("https://minimax.example.com/v1"),
        ).toBe("https://minimax.example.com/v1/speech_to_text");
        expect(buildMinimaxSpeechToTextUrl("https://api.minimax.io")).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
    });

    it("uses the public MiniMax host without a base_url", () => {
        expect(buildMinimaxSpeechToTextUrl(null)).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
        expect(buildMinimaxSpeechToTextUrl(undefined)).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
        expect(buildMinimaxSpeechToTextUrl("")).toBe(
            "https://api.minimax.io/v1/speech_to_text",
        );
    });
});

describe("isMiniMaxCredentials", () => {
    it("detects the preset name", () => {
        expect(isMiniMaxCredentials("MiniMax", "")).toBe(true);
        expect(isMiniMaxCredentials("minimax", null)).toBe(true);
    });

    it("detects custom rows via the base_url", () => {
        expect(
            isMiniMaxCredentials("Custom", "https://api.minimax.io/v1"),
        ).toBe(true);
        expect(
            isMiniMaxCredentials("My STT", "https://api.minimax.io/v1"),
        ).toBe(true);
    });

    it("is false for foreign providers", () => {
        expect(isMiniMaxCredentials("OpenAI", "")).toBe(false);
        expect(
            isMiniMaxCredentials("Custom", "https://api.groq.com/openai/v1"),
        ).toBe(false);
        expect(isMiniMaxCredentials("Custom", null)).toBe(false);
    });
});

function stubFetch(status = 200, payload: unknown = {}) {
    return vi.fn(async (_url: unknown, _init?: RequestInit) => {
        return new Response(JSON.stringify(payload), {
            status,
            headers: { "content-type": "application/json" },
        });
    });
}

const verbosePayload = {
    text: "Hallo Welt",
    duration: 15.3,
    n_speakers: 2,
    segments: [
        { start: 0.0, end: 2.5, speaker: "S1", text: "Hallo" },
        { start: 2.6, end: 5.0, speaker: "S2", text: "Welt" },
    ],
};

describe("transcribeMinimax", () => {
    it("sends language as an HTTP header, not as a form field", async () => {
        const fetchImpl = stubFetch(200, verbosePayload);
        await transcribeMinimax({
            apiKey: "sk-test",
            baseUrl: "https://api.minimax.io/v1",
            audioBuffer: Buffer.from([1, 2, 3]),
            contentType: "audio/ogg",
            filename: "aufnahme.ogg",
            language: "de",
            timeoutMs: 30_000,
            fetchImpl,
        });

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.minimax.io/v1/speech_to_text");
        expect(init.method).toBe("POST");

        const headers = new Headers(init.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-test");
        // The critical part: language as a header (BCP-47) ...
        expect(headers.get("language")).toBe("de");

        const form = init.body as FormData;
        expect(form.get("model")).toBe("asr-1.0");
        expect(form.get("response_format")).toBe("verbose_json");
        // ... and deliberately NO language form field.
        expect(form.get("language")).toBeNull();

        const file = form.get("file") as File;
        expect(file).toBeInstanceOf(File);
        expect(file.name).toBe("aufnahme.ogg");
        expect(file.type).toBe("audio/ogg");
    });

    it("omits the language header when no language is set", async () => {
        const fetchImpl = stubFetch(200, verbosePayload);
        await transcribeMinimax({
            apiKey: "sk-test",
            audioBuffer: Buffer.from([1, 2, 3]),
            contentType: "audio/ogg",
            filename: "aufnahme.ogg",
            timeoutMs: 30_000,
            fetchImpl,
        });

        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        const headers = new Headers(init.headers);
        expect(headers.get("language")).toBeNull();
    });

    it("uses the passed model (default asr-1.0)", async () => {
        const fetchImpl = stubFetch(200, verbosePayload);
        await transcribeMinimax({
            apiKey: "sk-test",
            model: "asr-1.0-fast",
            audioBuffer: Buffer.from([1]),
            contentType: "audio/ogg",
            filename: "a.ogg",
            timeoutMs: 30_000,
            fetchImpl,
        });
        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect((init.body as FormData).get("model")).toBe("asr-1.0-fast");
    });

    it("parses verbose_json including diarization segments", async () => {
        const fetchImpl = stubFetch(200, verbosePayload);
        const result = await transcribeMinimax({
            apiKey: "sk-test",
            audioBuffer: Buffer.from([1]),
            contentType: "audio/ogg",
            filename: "a.ogg",
            timeoutMs: 30_000,
            fetchImpl,
        });

        expect(result.text).toBe("Hallo Welt");
        expect(result.duration).toBe(15.3);
        expect(result.n_speakers).toBe(2);
        expect(result.segments).toHaveLength(2);
        expect(result.segments?.[0]).toEqual({
            start: 0,
            end: 2.5,
            speaker: "S1",
            text: "Hallo",
        });
    });

    it("maps 429 and 5xx to retryable MiniMaxTranscriptionError", async () => {
        for (const status of [429, 500, 502]) {
            const fetchImpl = stubFetch(status, {
                error: "overloaded",
            });
            const error = await transcribeMinimax({
                apiKey: "sk-test",
                audioBuffer: Buffer.from([1]),
                contentType: "audio/ogg",
                filename: "a.ogg",
                timeoutMs: 30_000,
                fetchImpl,
            }).then(
                () => null,
                (e) => e,
            );
            expect(error).toBeInstanceOf(MiniMaxTranscriptionError);
            expect((error as MiniMaxTranscriptionError).status).toBe(status);
            expect((error as MiniMaxTranscriptionError).retryable).toBe(true);
        }
    });

    it("maps 4xx (except 429) to non-retryable errors", async () => {
        const fetchImpl = stubFetch(400, { error: "bad request" });
        const error = await transcribeMinimax({
            apiKey: "sk-test",
            audioBuffer: Buffer.from([1]),
            contentType: "audio/ogg",
            filename: "a.ogg",
            timeoutMs: 30_000,
            fetchImpl,
        }).then(
            () => null,
            (e) => e,
        );
        expect(error).toBeInstanceOf(MiniMaxTranscriptionError);
        expect((error as MiniMaxTranscriptionError).status).toBe(400);
        expect((error as MiniMaxTranscriptionError).retryable).toBe(false);
    });

    it("maps timeouts to retryable errors", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new DOMException("Timeout", "TimeoutError");
        });
        const error = await transcribeMinimax({
            apiKey: "sk-test",
            audioBuffer: Buffer.from([1]),
            contentType: "audio/ogg",
            filename: "a.ogg",
            timeoutMs: 30_000,
            fetchImpl,
        }).then(
            () => null,
            (e) => e,
        );
        expect(error).toBeInstanceOf(MiniMaxTranscriptionError);
        expect((error as MiniMaxTranscriptionError).retryable).toBe(true);
    });

    it("throws when the response contains no text", async () => {
        const fetchImpl = stubFetch(200, { foo: "bar" });
        await expect(
            transcribeMinimax({
                apiKey: "sk-test",
                audioBuffer: Buffer.from([1]),
                contentType: "audio/ogg",
                filename: "a.ogg",
                timeoutMs: 30_000,
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(MiniMaxTranscriptionError);
    });
});
