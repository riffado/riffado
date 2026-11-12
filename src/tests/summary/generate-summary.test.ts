/**
 * `generateSummaryForRecording` must never route to an ElevenLabs
 * credential -- ElevenLabs Scribe is transcription-only and has no
 * `chat.completions` endpoint. These tests pin the enhancement-provider
 * selection: skip ElevenLabs and fall through to another provider, and
 * fall back to the existing "no provider" `AppError` when ElevenLabs is
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
    decryptText: vi.fn((value: string) => value),
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/persist", () => ({
    upsertEnhancement: vi.fn().mockResolvedValue({ committed: true }),
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
import { ErrorCode } from "@/lib/errors";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";

const userId = "user-1";
const recordingId = "rec-1";

function mockLookups(credentialRows: Record<string, unknown>[]) {
    (db.select as Mock)
        // recording
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ id: recordingId, userId }]),
                }),
            }),
        })
        // transcription
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ text: "raw transcript" }]),
                }),
            }),
        })
        // user settings
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        })
        // credentials
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockResolvedValue(credentialRows),
                }),
            }),
        });
}

beforeEach(() => {
    vi.clearAllMocks();
    chatCompletionsCreate.mockResolvedValue({
        choices: [
            {
                message: {
                    content: JSON.stringify({
                        summary: "A summary",
                        keyPoints: [],
                        actionItems: [],
                    }),
                },
            },
        ],
    });
});

describe("generateSummaryForRecording -- enhancement provider exclusion", () => {
    it("skips an ElevenLabs credential and falls through to another provider", async () => {
        mockLookups([
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

        const result = await generateSummaryForRecording(userId, recordingId);

        expect(result.provider).toBe("OpenAI");
        expect(result.summary).toBe("A summary");
        expect(chatCompletionsCreate).toHaveBeenCalledOnce();
        const payload = chatCompletionsCreate.mock.calls[0][0] as {
            messages: { role: string; content: string }[];
        };
        expect(payload.messages[0]?.role).toBe("system");
        expect(payload.messages[0]?.content).toMatch(/untrusted/i);
        expect(payload.messages[0]?.content).not.toContain("raw transcript");
        expect(payload.messages[1]?.role).toBe("user");
        expect(payload.messages[1]?.content).toContain("raw transcript");
    });

    it("throws AI_PROVIDER_NOT_CONFIGURED when ElevenLabs is the only credential", async () => {
        mockLookups([
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

        await expect(
            generateSummaryForRecording(userId, recordingId),
        ).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
        });
        expect(chatCompletionsCreate).not.toHaveBeenCalled();
    });
});

describe("generateSummaryForRecording -- model and endpoint", () => {
    function openAiOptions() {
        return (OpenAI as unknown as Mock).mock.calls[0][0] as {
            baseURL?: string;
        };
    }

    function requestedModel() {
        return (chatCompletionsCreate.mock.calls[0][0] as { model: string })
            .model;
    }

    it("uses the endpoint's chat model when the provider name conflicts", async () => {
        mockLookups([
            {
                id: "creds-edited",
                provider: "OpenAI",
                apiKey: "enc-1",
                baseUrl: "https://api.together.xyz/v1",
                defaultModel: "openai/whisper-large-v3",
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        await generateSummaryForRecording(userId, recordingId);

        expect(openAiOptions().baseURL).toBe("https://api.together.xyz/v1");
        expect(requestedModel()).toBe(
            "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        );
    });

    it("sends a Gemini credential without a URL to Google's endpoint", async () => {
        mockLookups([
            {
                id: "creds-gemini",
                provider: "Google Gemini",
                apiKey: "enc-1",
                baseUrl: null,
                defaultModel: null,
                isDefaultEnhancement: true,
                createdAt: new Date("2026-01-01"),
            },
        ]);

        await generateSummaryForRecording(userId, recordingId);

        expect(openAiOptions().baseURL).toBe(
            "https://generativelanguage.googleapis.com/v1beta/openai",
        );
        expect(requestedModel()).toBe("gemini-2.5-flash-lite");
    });

    it("parses the JSON after an inline reasoning block", async () => {
        chatCompletionsCreate.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        content: `<think>Summarize it.</think>\n${JSON.stringify(
                            {
                                summary: "Clean summary",
                                keyPoints: ["a"],
                                actionItems: [],
                            },
                        )}`,
                    },
                },
            ],
        });
        mockLookups([
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

        const result = await generateSummaryForRecording(userId, recordingId);

        expect(result.summary).toBe("Clean summary");
    });
});
