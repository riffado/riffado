/**
 * MiniMax style in the provider test button.
 *
 * The test previously ran ALL transcription providers through
 * /v1/audio/transcriptions — MiniMax has no such endpoint and answered
 * 404. The style is now detected via isMiniMaxCredentials (preset name
 * OR base_url) and tested against /v1/speech_to_text (language as an
 * HTTP header, see minimax.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        WHISPER_REQUEST_TIMEOUT_MS: 30_000,
    },
}));

const { audioTranscriptionsCreate, minimaxTranscribeMock } = vi.hoisted(() => ({
    audioTranscriptionsCreate: vi.fn(),
    minimaxTranscribeMock: vi.fn(),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return {
            chat: { completions: { create: vi.fn() } },
            audio: { transcriptions: { create: audioTranscriptionsCreate } },
        };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/transcription/gemini-transcribe", () => ({
    geminiTranscribe: vi.fn(),
}));

vi.mock("@/lib/transcription/elevenlabs-transcribe", () => ({
    elevenLabsTranscribe: vi.fn(),
}));

// Keep isMiniMaxCredentials/MINIMAX_DEFAULT_MODEL real (pure logic),
// replace only the network call.
vi.mock("@/lib/transcription/minimax", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/lib/transcription/minimax")>();
    return { ...actual, transcribeMinimax: minimaxTranscribeMock };
});

import { testProviderConnection } from "@/lib/ai/test-provider";

describe("testProviderConnection MiniMax style", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        minimaxTranscribeMock.mockResolvedValue({ text: "Hallo Welt" });
    });

    it("custom provider with a MiniMax base_url goes to speech_to_text, not /audio/transcriptions", async () => {
        const result = await testProviderConnection({
            provider: "Custom",
            apiKey: "sk-test",
            baseUrl: "https://api.minimax.io/v1",
        });

        expect(result.ok).toBe(true);
        expect(result.detail).toBe("Hallo Welt");
        expect(minimaxTranscribeMock).toHaveBeenCalledTimes(1);
        expect(audioTranscriptionsCreate).not.toHaveBeenCalled();

        const args = minimaxTranscribeMock.mock.calls[0][0];
        expect(args.baseUrl).toBe("https://api.minimax.io/v1");
        // language set as an HTTP header (transcribeMinimax sets the
        // header from the language argument) — and NOT as a form field.
        expect(args.language).toBe("en");
        expect(args.model).toBe("asr-1.0");
        expect(args.contentType).toBe("audio/wav");
        expect(args.filename).toBe("riffado-test.wav");
        expect(args.audioBuffer).toBeInstanceOf(Buffer);
    });

    it("the MiniMax preset name also routes to the MiniMax style", async () => {
        const result = await testProviderConnection({
            provider: "MiniMax",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(true);
        expect(minimaxTranscribeMock).toHaveBeenCalledTimes(1);
        expect(minimaxTranscribeMock.mock.calls[0][0].model).toBe("asr-1.0");
        expect(audioTranscriptionsCreate).not.toHaveBeenCalled();
    });

    it("a foreign base_url stays whisper style (no MiniMax detection)", async () => {
        audioTranscriptionsCreate.mockResolvedValue({ text: "" });

        const result = await testProviderConnection({
            provider: "Custom",
            apiKey: "sk-test",
            baseUrl: "https://api.groq.com/openai/v1",
            defaultModel: "whisper-large-v3",
        });

        expect(result.ok).toBe(true);
        expect(audioTranscriptionsCreate).toHaveBeenCalledTimes(1);
        expect(minimaxTranscribeMock).not.toHaveBeenCalled();
    });

    it("error detail contains the real HTTP status (MiniMax 404)", async () => {
        minimaxTranscribeMock.mockRejectedValue(
            Object.assign(
                new Error(
                    "MiniMax speech_to_text responded with 404: not found",
                ),
                { status: 404 },
            ),
        );

        const result = await testProviderConnection({
            provider: "MiniMax",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(false);
        expect(result.detail).toContain("HTTP 404");
        expect(result.detail).toContain("not found");
    });

    it("error detail contains the real HTTP status (whisper 429)", async () => {
        audioTranscriptionsCreate.mockRejectedValue(
            Object.assign(new Error("Rate limit reached for requests"), {
                status: 429,
            }),
        );

        const result = await testProviderConnection({
            provider: "Groq",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(false);
        expect(result.detail).toContain("HTTP 429");
        expect(result.detail).toContain("Rate limit");
    });
});
