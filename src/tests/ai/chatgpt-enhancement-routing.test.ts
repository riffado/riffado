/**
 * Summaries and titles on a ChatGPT credential go through the plan-usage
 * Responses path, never `chat.completions` with the sealed token blob as
 * an API key.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: { select: vi.fn() },
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

const { chatCompletionsCreate, runChatGptCompletion } = vi.hoisted(() => ({
    chatCompletionsCreate: vi.fn(),
    runChatGptCompletion: vi.fn(),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return { chat: { completions: { create: chatCompletionsCreate } } };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/ai/chatgpt/connect", () => ({ runChatGptCompletion }));

import { db } from "@/db";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";
import { upsertEnhancement } from "@/lib/transcription/persist";

const chatGptRow = {
    id: "creds-chatgpt",
    userId: "user-1",
    provider: "ChatGPT",
    apiKey: "sealed-token-blob",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "plan-model",
    isDefaultEnhancement: true,
    isDefaultTranscription: false,
    createdAt: new Date(),
};

function selectReturning(rows: unknown[], terminal: "limit" | "orderBy") {
    const terminalFn = vi.fn().mockResolvedValue(rows);
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ [terminal]: terminalFn }),
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("ChatGPT plan usage routing", () => {
    it("generates titles through the Responses path", async () => {
        (db.select as Mock)
            .mockReturnValueOnce(selectReturning([], "limit"))
            .mockReturnValueOnce(selectReturning([chatGptRow], "orderBy"));
        runChatGptCompletion.mockResolvedValue({
            text: '"Weekly sync: budget"',
            model: "plan-model",
        });

        const title = await generateTitleFromTranscription("user-1", "hello");

        expect(title).toBe("Weekly sync budget");
        expect(chatCompletionsCreate).not.toHaveBeenCalled();
        expect(runChatGptCompletion).toHaveBeenCalledWith(
            chatGptRow,
            expect.objectContaining({
                model: "plan-model",
                input: expect.stringContaining("hello"),
            }),
        );
    });

    it("generates summaries through the Responses path and records the model used", async () => {
        (db.select as Mock)
            .mockReturnValueOnce(
                selectReturning([{ id: "rec-1", userId: "user-1" }], "limit"),
            )
            .mockReturnValueOnce(
                selectReturning([{ text: "the transcript" }], "limit"),
            )
            .mockReturnValueOnce(selectReturning([], "limit"))
            .mockReturnValueOnce(selectReturning([chatGptRow], "orderBy"));
        runChatGptCompletion.mockResolvedValue({
            text: '{"summary":"S","keyPoints":["k"],"actionItems":[]}',
            model: "plan-model",
        });

        const result = await generateSummaryForRecording("user-1", "rec-1");

        expect(chatCompletionsCreate).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            summary: "S",
            keyPoints: ["k"],
            provider: "ChatGPT",
            model: "plan-model",
        });
        expect(upsertEnhancement).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: "ChatGPT",
                model: "plan-model",
            }),
        );
    });
});
