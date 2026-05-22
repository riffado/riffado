import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return {
            audio: {
                transcriptions: {
                    create: vi.fn().mockResolvedValue({
                        text: "Fresh transcript",
                        language: "en",
                    }),
                },
            },
        };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/summary/generate-summary", () => ({
    generateSummaryForRecording: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
    consumeRateLimitBucket: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetAt: new Date(Date.now() + 3600_000),
    }),
}));

import { db } from "@/db";
import { consumeRateLimitBucket } from "@/lib/rate-limit";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";

type UserSettingsRow = {
    autoGenerateTitle: boolean;
    syncTitleToPlaud: boolean;
    autoSummarize: boolean;
    autoSummarizePreset: string | null;
};

/**
 * Mount the standard select-chain mocks that `transcribeRecording`
 * walks through before reaching the auto-summarize branch:
 *   1. recording lookup
 *   2. existing transcription (none)
 *   3. credentials (transcription provider)
 *   4. userSettings row
 */
function mountSelectChain(settings: UserSettingsRow) {
    (db.select as Mock)
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            id: "rec-1",
                            userId: "user-1",
                            plaudFileId: "plaud-1",
                            filename: "Original Title",
                            storagePath: "test.mp3",
                            deletedAt: null,
                        },
                    ]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            id: "creds-1",
                            provider: "openai",
                            apiKey: "encrypted-key",
                            defaultModel: "whisper-1",
                            baseUrl: null,
                        },
                    ]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([settings]),
                }),
            }),
        });
}

function mountInsertTransaction() {
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });
    const recordingBumpWhere = vi.fn().mockResolvedValue(undefined);
    const recordingBumpSet = vi.fn().mockReturnValue({
        where: recordingBumpWhere,
    });
    const txUpdate = vi.fn().mockReturnValue({ set: recordingBumpSet });
    const tx = {
        select: vi
            .fn()
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        for: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([{ deletedAt: null }]),
                        }),
                    }),
                }),
            })
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            }),
        insert: txInsert,
        update: txUpdate,
    };
    (db.transaction as Mock).mockImplementation(
        async (callback: (t: typeof tx) => Promise<unknown> | unknown) =>
            callback(tx),
    );
    (db.update as Mock).mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    });
}

describe("Auto-summarize integration with transcribeRecording", () => {
    const mockUserId = "user-1";
    const mockRecordingId = "rec-1";

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset rate-limit default to allowed; individual tests can
        // override to exercise the exhaustion path.
        (consumeRateLimitBucket as Mock).mockResolvedValue({
            allowed: true,
            limit: 60,
            remaining: 59,
            resetAt: new Date(Date.now() + 3600_000),
        });
    });

    it("does NOT call generateSummary when autoSummarize is false", async () => {
        mountSelectChain({
            autoGenerateTitle: false,
            syncTitleToPlaud: false,
            autoSummarize: false,
            autoSummarizePreset: null,
        });
        mountInsertTransaction();

        const result = await transcribeRecording(mockUserId, mockRecordingId);

        expect(result.success).toBe(true);
        expect(generateSummaryForRecording).not.toHaveBeenCalled();
        expect(emitEvent).toHaveBeenCalledWith(
            "transcription.completed",
            mockUserId,
            mockRecordingId,
        );
        const summaryEvents = (emitEvent as Mock).mock.calls.filter((c) =>
            String(c[0]).startsWith("summary."),
        );
        expect(summaryEvents).toHaveLength(0);
    });

    it("calls generateSummary with no preset when autoSummarize is true and preset is null", async () => {
        mountSelectChain({
            autoGenerateTitle: false,
            syncTitleToPlaud: false,
            autoSummarize: true,
            autoSummarizePreset: null,
        });
        mountInsertTransaction();
        (generateSummaryForRecording as Mock).mockResolvedValue({
            summary: "ok",
            keyPoints: [],
            actionItems: [],
            provider: "openai",
            model: "gpt-4o-mini",
        });

        const result = await transcribeRecording(mockUserId, mockRecordingId);

        expect(result.success).toBe(true);
        expect(generateSummaryForRecording).toHaveBeenCalledTimes(1);
        expect(generateSummaryForRecording).toHaveBeenCalledWith(
            mockUserId,
            mockRecordingId,
            { presetId: undefined },
        );
        expect(emitEvent).toHaveBeenCalledWith(
            "summary.completed",
            mockUserId,
            mockRecordingId,
        );
    });

    it("passes autoSummarizePreset to generateSummary when set", async () => {
        mountSelectChain({
            autoGenerateTitle: false,
            syncTitleToPlaud: false,
            autoSummarize: true,
            autoSummarizePreset: "meeting-notes",
        });
        mountInsertTransaction();
        (generateSummaryForRecording as Mock).mockResolvedValue({
            summary: "ok",
            keyPoints: [],
            actionItems: [],
            provider: "openai",
            model: "gpt-4o-mini",
        });

        const result = await transcribeRecording(mockUserId, mockRecordingId);

        expect(result.success).toBe(true);
        expect(generateSummaryForRecording).toHaveBeenCalledWith(
            mockUserId,
            mockRecordingId,
            { presetId: "meeting-notes" },
        );
    });

    it("keeps transcript success and emits summary.failed when summary throws", async () => {
        mountSelectChain({
            autoGenerateTitle: false,
            syncTitleToPlaud: false,
            autoSummarize: true,
            autoSummarizePreset: null,
        });
        mountInsertTransaction();
        (generateSummaryForRecording as Mock).mockRejectedValue(
            new Error("Provider down"),
        );

        const result = await transcribeRecording(mockUserId, mockRecordingId);

        expect(result.success).toBe(true);
        expect(emitEvent).toHaveBeenCalledWith(
            "transcription.completed",
            mockUserId,
            mockRecordingId,
        );
        expect(emitEvent).toHaveBeenCalledWith(
            "summary.failed",
            mockUserId,
            mockRecordingId,
            { error: "Provider down" },
        );
        const completedSummary = (emitEvent as Mock).mock.calls.find(
            (c) => c[0] === "summary.completed",
        );
        expect(completedSummary).toBeUndefined();
    });

    it("skips auto-summary and emits summary.failed when rate limit is exhausted", async () => {
        mountSelectChain({
            autoGenerateTitle: false,
            syncTitleToPlaud: false,
            autoSummarize: true,
            autoSummarizePreset: null,
        });
        mountInsertTransaction();
        (consumeRateLimitBucket as Mock).mockResolvedValue({
            allowed: false,
            limit: 60,
            remaining: 0,
            resetAt: new Date(Date.now() + 3600_000),
        });

        const result = await transcribeRecording(mockUserId, mockRecordingId);

        expect(result.success).toBe(true);
        expect(generateSummaryForRecording).not.toHaveBeenCalled();
        expect(emitEvent).toHaveBeenCalledWith(
            "transcription.completed",
            mockUserId,
            mockRecordingId,
        );
        const failedCall = (emitEvent as Mock).mock.calls.find(
            (c) => c[0] === "summary.failed",
        );
        expect(failedCall).toBeDefined();
        expect(String(failedCall?.[3]?.error)).toMatch(/rate limit/i);
    });
});
