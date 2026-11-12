/**
 * `generateTitleFromTranscription` must never route to an ElevenLabs
 * credential -- ElevenLabs Scribe is transcription-only and has no
 * `chat.completions` endpoint. These tests pin the enhancement-provider
 * selection: skip ElevenLabs and fall through to another provider, and
 * fall back to the existing "no provider" behavior when ElevenLabs is
 * the only configured credential.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptJsonField: vi.fn().mockReturnValue(null),
}));

const { chatCompletionsCreate } = vi.hoisted(() => ({
    chatCompletionsCreate: vi.fn(),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return {
            chat: { completions: { create: chatCompletionsCreate } },
        };
    });
    return { OpenAI: MockOpenAI };
});

import { OpenAI } from "openai";
import { db } from "@/db";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";

function mockUserSettings(row: Record<string, unknown> | null = null) {
    (db.select as Mock).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(row ? [row] : []),
            }),
        }),
    });
}

function mockCredentials(rows: Record<string, unknown>[]) {
    (db.select as Mock).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(rows),
            }),
        }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    chatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: "Generated Title" } }],
    });
});

describe("generateTitleFromTranscription -- enhancement provider exclusion", () => {
    it("skips an ElevenLabs credential and falls through to another provider", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-el",
                provider: "ElevenLabs",
                apiKey: "enc-1",
                baseUrl: null,
                defaultModel: "scribe_v2",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
            {
                id: "creds-oai",
                provider: "OpenAI",
                apiKey: "enc-2",
                baseUrl: null,
                defaultModel: "gpt-4o-mini",
                isDefaultEnhancement: false,
                createdAt: new Date("2026-01-02"),
            },
        ]);

        const title = await generateTitleFromTranscription(
            "user-1",
            "some transcript text",
        );

        expect(title).toBe("Generated Title");
        expect(chatCompletionsCreate).toHaveBeenCalledOnce();
        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            messages: { role: string; content: string }[];
        };
        expect(payload.messages[0]?.role).toBe("system");
        expect(payload.messages[0]?.content).toMatch(/untrusted/i);
        expect(payload.messages[0]?.content).not.toContain(
            "some transcript text",
        );
        expect(payload.messages[1]?.role).toBe("user");
        expect(payload.messages[1]?.content).toContain("some transcript text");
    });

    it("returns null (no-provider behavior) when ElevenLabs is the only credential", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-el",
                provider: "ElevenLabs",
                apiKey: "enc-1",
                baseUrl: null,
                defaultModel: "scribe_v2",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        const title = await generateTitleFromTranscription(
            "user-1",
            "some transcript text",
        );

        expect(title).toBeNull();
        expect(chatCompletionsCreate).not.toHaveBeenCalled();
    });
});

describe("generateTitleFromTranscription -- model selection", () => {
    it("uses the provider chat model when the credential model is a Whisper id", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-groq",
                provider: "Groq",
                apiKey: "enc-1",
                baseUrl: "https://api.groq.com/openai/v1",
                defaultModel: "whisper-large-v3-turbo",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        const title = await generateTitleFromTranscription(
            "user-1",
            "some transcript text",
        );

        expect(title).toBe("Generated Title");
        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            model: string;
        };
        expect(payload.model).toBe("qwen/qwen3.8-27b");
        expect(payload.model).not.toContain("whisper");
        expect(payload.model).not.toBe("gpt-4o-mini");
    });

    it("keeps an explicit chat model from the credential", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-groq",
                provider: "Groq",
                apiKey: "enc-1",
                baseUrl: "https://api.groq.com/openai/v1",
                defaultModel: "openai/gpt-oss-120b",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        await generateTitleFromTranscription("user-1", "some transcript text");

        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            model: string;
        };
        expect(payload.model).toBe("openai/gpt-oss-120b");
    });

    it("resolves a Custom credential's endpoint for the chat model", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-custom",
                provider: "Custom",
                apiKey: "enc-1",
                baseUrl: "https://api.together.xyz/v1",
                defaultModel: "openai/whisper-large-v3",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        await generateTitleFromTranscription("user-1", "some transcript text");

        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            model: string;
        };
        expect(payload.model).toBe(
            "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        );
    });

    it("skips a legacy lowercase elevenlabs credential", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-eleven",
                provider: "elevenlabs",
                apiKey: "enc-1",
                baseUrl: null,
                defaultModel: "scribe_v2",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
            {
                id: "creds-groq",
                provider: "Groq",
                apiKey: "enc-2",
                baseUrl: "https://api.groq.com/openai/v1",
                defaultModel: "whisper-large-v3-turbo",
                isDefaultEnhancement: false,
                createdAt: new Date("2026-01-02"),
            },
        ]);

        await generateTitleFromTranscription("user-1", "some transcript text");

        // Only the Groq row can give this endpoint and model.
        const options = (OpenAI as unknown as Mock).mock.calls[0][0] as {
            baseURL?: string;
        };
        expect(options.baseURL).toBe("https://api.groq.com/openai/v1");
        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            model: string;
        };
        expect(payload.model).toBe("qwen/qwen3.8-27b");
    });

    it("sends a Gemini credential without a URL to Google's OpenAI-compatible endpoint", async () => {
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-gemini",
                provider: "Google Gemini",
                apiKey: "enc-1",
                baseUrl: null,
                // The old preset default, which Google shut down.
                defaultModel: "gemini-2.0-flash",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        await generateTitleFromTranscription("user-1", "some transcript text");

        const options = (OpenAI as unknown as Mock).mock.calls[0][0] as {
            baseURL?: string;
        };
        expect(options.baseURL).toBe(
            "https://generativelanguage.googleapis.com/v1beta/openai",
        );
        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            model: string;
        };
        expect(payload.model).toBe("gemini-2.5-flash-lite");
    });

    it("drops inline reasoning from a reasoning model's reply", async () => {
        chatCompletionsCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        content:
                            "<think>Pick a short title.</think>\nTeam sync",
                    },
                },
            ],
        });
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-groq",
                provider: "Groq",
                apiKey: "enc-1",
                baseUrl: "https://api.groq.com/openai/v1",
                defaultModel: "whisper-large-v3-turbo",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        const title = await generateTitleFromTranscription(
            "user-1",
            "some transcript text",
        );

        expect(title).toBe("Team sync");
    });

    it("returns null when the reply is only unfinished reasoning", async () => {
        chatCompletionsCreate.mockResolvedValueOnce({
            choices: [{ message: { content: "<think>Still thinking" } }],
        });
        mockUserSettings();
        mockCredentials([
            {
                id: "creds-groq",
                provider: "Groq",
                apiKey: "enc-1",
                baseUrl: "https://api.groq.com/openai/v1",
                defaultModel: "whisper-large-v3-turbo",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        expect(
            await generateTitleFromTranscription("user-1", "some transcript"),
        ).toBeNull();
    });
});
