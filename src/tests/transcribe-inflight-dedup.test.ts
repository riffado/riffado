/**
 * Pins same-process in-flight dedup in `transcribeRecording`.
 *
 * Two same-worker paths can race the provider for one recording:
 *   1. Manual `POST /api/recordings/[id]/transcribe` (`force: true`).
 *      Retry double-click fans out two concurrent provider calls.
 *   2. Post-sync auto-transcribe (`queueTranscriptions` in
 *      `sync-recordings.ts`) can land mid-Retry on the same worker.
 *
 * #282's `claimAutoTranscribeIds` only skips ids already in the
 * auto-transcribe set. It does not cover Retry double-click or Retry
 * overlapping a sync pass. This map is complementary, not a substitute.
 *
 * Concurrent calls for the same (userId, recordingId) share one
 * in-flight promise. Mirrors `inFlightSyncs` in `sync-recordings.ts`.
 * Multi-process hosted correctness is out of scope.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

vi.mock("@/lib/encryption/fields", async () => {
    const actual = await vi.importActual<
        typeof import("@/lib/encryption/fields")
    >("@/lib/encryption/fields");
    return {
        ...actual,
        decryptText: vi.fn((value: string) => value),
        encryptText: vi.fn((value: string) => `enc:${value}`),
    };
});

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("fake-mp3-bytes")),
    }),
}));

const audioCreate = vi.fn();
const chatCreate = vi.fn();

vi.mock("openai", () => {
    const MockOpenAI = vi.fn(() => ({
        audio: { transcriptions: { create: audioCreate } },
        chat: { completions: { create: chatCreate } },
    }));
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/env", () => ({
    env: {
        WHISPER_MAX_BYTES: 24 * 1024 * 1024,
        WHISPER_COMPRESS_BITRATE_KBPS: 12,
        WHISPER_REQUEST_TIMEOUT_MS: 60 * 60 * 1000,
    },
}));

vi.mock("@/lib/hosted/transcription/mynah", () => ({
    isMynahConfigured: vi.fn().mockReturnValue(false),
    transcribeViaMynah: vi.fn(),
}));

vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

import { OpenAI } from "openai";
import { db } from "@/db";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

const USER_ID = "user-dedup";

/**
 * Stage one full transcribe attempt's worth of DB reads on `db.select`
 * and `db.transaction`. Matches the current `transcribeRecordingInner`
 * select order: recording, existing riffado transcript, default
 * credentials, user settings. Each inner call consumes one staging.
 * Staging twice covers a non-deduped fanout and is harmless overshoot
 * when dedup engages.
 */
function stageOneAttempt(recordingId: string, userId: string = USER_ID) {
    const recordingRow = {
        id: recordingId,
        userId,
        plaudFileId: `plaud-${recordingId}`,
        filename: "Some Recording",
        storagePath: `${recordingId}.mp3`,
        deletedAt: null,
    };
    const credsRow = {
        id: "creds-1",
        provider: "OpenAI",
        apiKey: "encrypted-key",
        baseUrl: null,
        defaultModel: "whisper-1",
    };

    (db.select as Mock)
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([recordingRow]),
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
                    limit: vi.fn().mockResolvedValue([credsRow]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            autoGenerateTitle: false,
                            syncTitleToPlaud: false,
                            transcriptionQuality: "balanced",
                            defaultTranscriptionLanguage: null,
                        },
                    ]),
                }),
            }),
        });

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
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
    };
    (db.transaction as Mock).mockImplementationOnce(
        async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );
    (db.delete as Mock).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
    });
}

describe("transcribeRecording — in-flight dedup", () => {
    beforeEach(() => {
        (db.select as Mock).mockReset();
        (db.transaction as Mock).mockReset();
        (db.delete as Mock).mockReset();
        audioCreate.mockReset();
        chatCreate.mockReset();
        // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
        (OpenAI as unknown as Mock).mockImplementation(function () {
            return {
                audio: { transcriptions: { create: audioCreate } },
                chat: { completions: { create: chatCreate } },
            };
        });
    });

    it("collapses two concurrent calls for the same recording into a single provider call (shared result, single audioCreate)", async () => {
        audioCreate.mockResolvedValue({
            text: "shared transcript",
            language: "en",
        });
        stageOneAttempt("rec-shared");
        stageOneAttempt("rec-shared");

        const callA = transcribeRecording(USER_ID, "rec-shared", {
            force: true,
        });
        const callB = transcribeRecording(USER_ID, "rec-shared", {
            force: true,
        });

        const [resA, resB] = await Promise.all([callA, callB]);

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        expect(resA).toBe(resB);
        expect(audioCreate).toHaveBeenCalledTimes(1);
    });

    it("shares the in-flight promise when Retry (force) overlaps a sync auto-transcribe", async () => {
        audioCreate.mockResolvedValue({
            text: "overlap transcript",
            language: "en",
        });
        stageOneAttempt("rec-overlap");
        stageOneAttempt("rec-overlap");

        const retry = transcribeRecording(USER_ID, "rec-overlap", {
            force: true,
            trigger: "manual",
        });
        const auto = transcribeRecording(USER_ID, "rec-overlap", {
            trigger: "sync",
        });

        const [resRetry, resAuto] = await Promise.all([retry, auto]);

        expect(resRetry.success).toBe(true);
        expect(resAuto.success).toBe(true);
        expect(resRetry).toBe(resAuto);
        expect(audioCreate).toHaveBeenCalledTimes(1);
    });

    it("does NOT dedup across distinct recordingIds (each gets its own provider call)", async () => {
        audioCreate.mockResolvedValue({
            text: "transcript",
            language: "en",
        });
        stageOneAttempt("rec-a");
        const resA = await transcribeRecording(USER_ID, "rec-a", {
            force: true,
        });
        stageOneAttempt("rec-b");
        const resB = await transcribeRecording(USER_ID, "rec-b", {
            force: true,
        });

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("does NOT dedup across distinct users even with the same recordingId (key namespaces by userId)", async () => {
        audioCreate.mockResolvedValue({
            text: "transcript",
            language: "en",
        });
        stageOneAttempt("rec-shared-id", "user-a");
        const resA = await transcribeRecording("user-a", "rec-shared-id", {
            force: true,
        });
        stageOneAttempt("rec-shared-id", "user-b");
        const resB = await transcribeRecording("user-b", "rec-shared-id", {
            force: true,
        });

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("clears the in-flight cache after the promise settles so a follow-up call re-runs", async () => {
        audioCreate.mockResolvedValue({
            text: "first call",
            language: "en",
        });
        stageOneAttempt("rec-followup");
        const first = await transcribeRecording(USER_ID, "rec-followup", {
            force: true,
        });
        expect(first.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(1);

        audioCreate.mockResolvedValue({
            text: "second call",
            language: "en",
        });
        stageOneAttempt("rec-followup");
        const second = await transcribeRecording(USER_ID, "rec-followup", {
            force: true,
        });
        expect(second.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("propagates errors to all concurrent waiters and still clears the cache for a fresh retry", async () => {
        audioCreate.mockRejectedValueOnce(new Error("upstream 500"));
        stageOneAttempt("rec-error");
        stageOneAttempt("rec-error");

        const callA = transcribeRecording(USER_ID, "rec-error", {
            force: true,
        });
        const callB = transcribeRecording(USER_ID, "rec-error", {
            force: true,
        });

        const [resA, resB] = await Promise.all([callA, callB]);
        expect(resA.success).toBe(false);
        expect(resB.success).toBe(false);
        expect(resA.errorCode).toBe("TRANSCRIPTION_FAILED");
        expect(resB.errorCode).toBe("TRANSCRIPTION_FAILED");
        expect(resA).toBe(resB);
        expect(audioCreate).toHaveBeenCalledTimes(1);

        audioCreate.mockResolvedValueOnce({
            text: "succeeded on retry",
            language: "en",
        });
        stageOneAttempt("rec-error");
        const retry = await transcribeRecording(USER_ID, "rec-error", {
            force: true,
        });
        expect(retry.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });
});
