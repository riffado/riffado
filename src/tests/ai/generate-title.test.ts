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
