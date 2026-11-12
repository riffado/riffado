/**
 * Provider test-button logic (`testProviderConnection`).
 *
 * - "chat"-style providers get a mini chat completion ("Reply with OK").
 * - transcription styles (whisper/gemini/elevenlabs) receive a synthetic
 *   2s WAV via the same code path production transcription uses.
 * - Any thrown provider error is returned as `ok: false` with a trimmed
 *   detail message — the dialog renders it as a badge, no throw escapes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        WHISPER_REQUEST_TIMEOUT_MS: 30_000,
    },
}));

const {
    chatCompletionsCreate,
    audioTranscriptionsCreate,
    geminiTranscribeMock,
    elevenLabsTranscribeMock,
} = vi.hoisted(() => ({
    chatCompletionsCreate: vi.fn(),
    audioTranscriptionsCreate: vi.fn(),
    geminiTranscribeMock: vi.fn(),
    elevenLabsTranscribeMock: vi.fn(),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return {
            chat: { completions: { create: chatCompletionsCreate } },
            audio: { transcriptions: { create: audioTranscriptionsCreate } },
        };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/transcription/gemini-transcribe", () => ({
    geminiTranscribe: geminiTranscribeMock,
}));

vi.mock("@/lib/transcription/elevenlabs-transcribe", () => ({
    elevenLabsTranscribe: elevenLabsTranscribeMock,
}));

import { buildTestWav, testProviderConnection } from "@/lib/ai/test-provider";

describe("buildTestWav", () => {
    it("produces a valid 2s 16kHz mono 16-bit WAV", () => {
        const wav = buildTestWav();
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        expect(wav.readUInt16LE(22)).toBe(1); // mono
        expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
        expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
        // 2s * 16000 samples * 2 bytes + 44-byte header.
        expect(wav.length).toBe(44 + 2 * 16_000 * 2);
        // Duration is configurable.
        expect(buildTestWav(1).length).toBe(44 + 16_000 * 2);
    });
});

describe("testProviderConnection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("fails fast without an API key", async () => {
        const result = await testProviderConnection({
            provider: "OpenAI",
            apiKey: "",
        });
        expect(result.ok).toBe(false);
        expect(result.detail).toContain("API key");
        expect(chatCompletionsCreate).not.toHaveBeenCalled();
        expect(audioTranscriptionsCreate).not.toHaveBeenCalled();
    });

    it("chat style: sends 'Reply with OK' and reports the reply", async () => {
        chatCompletionsCreate.mockResolvedValue({
            choices: [{ message: { content: "OK" } }],
        });

        const result = await testProviderConnection({
            provider: "OpenRouter",
            apiKey: "sk-test",
            baseUrl: "https://openrouter.ai/api/v1",
            defaultModel: "openai/gpt-4o-audio-preview",
        });

        expect(result).toEqual({ ok: true, detail: "OK" });
        expect(chatCompletionsCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "openai/gpt-4o-audio-preview",
                messages: [{ role: "user", content: "Reply with OK" }],
            }),
        );
        expect(audioTranscriptionsCreate).not.toHaveBeenCalled();
    });

    it("chat style: an empty reply is a failure", async () => {
        chatCompletionsCreate.mockResolvedValue({
            choices: [{ message: { content: "  " } }],
        });

        const result = await testProviderConnection({
            provider: "OpenRouter",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(false);
        expect(result.detail).toContain("Empty reply");
    });

    it("whisper style: sends the 2s test clip to /audio/transcriptions", async () => {
        audioTranscriptionsCreate.mockResolvedValue({ text: "" });

        const result = await testProviderConnection({
            provider: "OpenAI",
            apiKey: "sk-test",
            defaultModel: "whisper-1",
        });

        expect(result.ok).toBe(true);
        expect(result.detail).toBe("Test audio accepted");
        expect(audioTranscriptionsCreate).toHaveBeenCalledTimes(1);
        expect(chatCompletionsCreate).not.toHaveBeenCalled();
        const params = audioTranscriptionsCreate.mock.calls[0][0];
        expect(params.model).toBe("whisper-1");
        expect(params.file).toBeInstanceOf(File);
        expect((params.file as File).name).toBe("riffado-test.wav");
        expect((params.file as File).type).toBe("audio/wav");
    });

    it("whisper style: transcript text is shown when present", async () => {
        audioTranscriptionsCreate.mockResolvedValue({
            text: "Hallo Welt",
        });

        const result = await testProviderConnection({
            provider: "Groq",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(true);
        expect(result.detail).toBe("Hallo Welt");
    });

    it("gemini style: delegates to geminiTranscribe with the test clip", async () => {
        geminiTranscribeMock.mockResolvedValue({
            text: "",
            detectedLanguage: null,
        });

        const result = await testProviderConnection({
            provider: "Google Gemini",
            apiKey: "sk-test",
            defaultModel: "gemini-2.0-flash",
        });

        expect(result).toEqual({ ok: true, detail: "Test audio accepted" });
        expect(geminiTranscribeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                apiKey: "sk-test",
                model: "gemini-2.0-flash",
                contentType: "audio/wav",
            }),
        );
        expect(
            geminiTranscribeMock.mock.calls[0][0].audioBuffer,
        ).toBeInstanceOf(Buffer);
    });

    it("elevenlabs style: delegates to elevenLabsTranscribe without diarization", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "",
            detectedLanguage: null,
            speakerCount: 0,
        });

        const result = await testProviderConnection({
            provider: "ElevenLabs",
            apiKey: "sk-test",
            defaultModel: "scribe_v1",
        });

        expect(result).toEqual({ ok: true, detail: "Test audio accepted" });
        expect(elevenLabsTranscribeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                apiKey: "sk-test",
                model: "scribe_v1",
                diarize: false,
            }),
        );
    });

    it("provider errors never throw; they become ok:false with the message", async () => {
        audioTranscriptionsCreate.mockRejectedValue(
            new Error("401 Incorrect API key provided"),
        );

        const result = await testProviderConnection({
            provider: "OpenAI",
            apiKey: "sk-wrong",
        });

        expect(result.ok).toBe(false);
        expect(result.detail).toContain("401 Incorrect API key");
    });

    it("long error messages are truncated for the badge", async () => {
        const longMessage = `x${"y".repeat(500)}`;
        audioTranscriptionsCreate.mockRejectedValue(new Error(longMessage));

        const result = await testProviderConnection({
            provider: "OpenAI",
            apiKey: "sk-test",
        });

        expect(result.ok).toBe(false);
        expect(result.detail.length).toBeLessThanOrEqual(120);
        expect(result.detail.endsWith("…")).toBe(true);
    });
});
