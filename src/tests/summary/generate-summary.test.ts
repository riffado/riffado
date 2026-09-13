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
