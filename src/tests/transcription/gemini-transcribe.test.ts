import { GoogleGenerativeAIResponseError } from "@google/generative-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";

const args = {
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    audioBuffer: Buffer.from("audio"),
    contentType: "audio/mpeg",
    timeoutMs: 1000,
};

function mockResponse(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Gemini transcription response handling", () => {
    it.each([
        "SAFETY",
        "RECITATION",
        "LANGUAGE",
    ])("rejects a partial candidate blocked by %s", async (finishReason) => {
        mockResponse({
            candidates: [
                {
                    content: { parts: [{ text: "partial transcript" }] },
                    finishReason,
                    finishMessage: "provider explanation",
                },
            ],
        });

        const error = await geminiTranscribe(args).catch((error) => error);
        expect(error).toBeInstanceOf(GoogleGenerativeAIResponseError);
        expect(error.message).toContain(
            `Candidate was blocked due to ${finishReason}: provider explanation`,
        );
    });

    it("reports prompt blocking instead of a silent-audio error", async () => {
        mockResponse({
            promptFeedback: {
                blockReason: "SAFETY",
                blockReasonMessage: "provider explanation",
            },
        });

        const error = await geminiTranscribe(args).catch((error) => error);
        expect(error).toBeInstanceOf(GoogleGenerativeAIResponseError);
        expect(error.message).toContain(
            "Text not available. Response was blocked due to SAFETY: provider explanation",
        );
    });

    it("keeps the SDK behavior for MAX_TOKENS and joins the first candidate's parts", async () => {
        mockResponse({
            candidates: [
                {
                    content: {
                        parts: [{ text: "hello " }, { text: "world" }],
                    },
                    finishReason: "MAX_TOKENS",
                },
                { content: { parts: [{ text: "another candidate" }] } },
            ],
        });

        expect(await geminiTranscribe(args)).toEqual({
            text: "hello world",
            detectedLanguage: null,
        });
    });

    it("preserves SDK text formatting for executable code and results", async () => {
        mockResponse({
            candidates: [
                {
                    content: {
                        parts: [
                            { text: "hello" },
                            {
                                executableCode: {
                                    language: "PYTHON",
                                    code: "print(1)",
                                },
                            },
                            { codeExecutionResult: { output: "1" } },
                        ],
                    },
                },
            ],
        });

        const result = await geminiTranscribe(args);
        expect(result.text).toBe(
            "hello\n```PYTHON\nprint(1)\n```\n\n```\n1\n```",
        );
    });

    it("retains the empty-transcription error for a response without text or feedback", async () => {
        mockResponse({ candidates: [] });
        await expect(geminiTranscribe(args)).rejects.toThrow(
            "Google Gemini returned an empty transcription",
        );
    });
});

describe("Gemini model resource names", () => {
    it.each([
        ["gemini-2.5-flash", "models/gemini-2.5-flash"],
        ["models/gemini-2.5-flash", "models/gemini-2.5-flash"],
        ["tunedModels/custom-model", "tunedModels/custom-model"],
        ["models/name?key=value", "models/name%3Fkey%3Dvalue"],
    ])("preserves the resource path for %s", async (model, path) => {
        const fetchMock = mockResponse({
            candidates: [{ content: { parts: [{ text: "hello" }] } }],
        });

        await geminiTranscribe({ ...args, model });

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            `https://generativelanguage.googleapis.com/v1beta/${path}:generateContent`,
        );
    });
});
