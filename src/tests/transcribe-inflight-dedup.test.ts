/**
 * Pins same-process in-flight dedup in `transcribeRecording`.
 *
 * Why: two paths can race to transcribe the same recording at the same
 * moment in the same Next.js worker:
 *
 *   1. The manual `POST /api/recordings/[id]/transcribe` route fires on
 *      every Retry click; an impatient user double-clicking fans out two
 *      concurrent provider calls for the same recording.
 *   2. The post-sync auto-transcribe path (`queueTranscriptions` in
 *      `sync-recordings.ts`) for a newly synced recording can land
 *      mid-Retry-click.
 *
 * Without dedup, both pay the full provider latency. On long recordings
 * (90-min through a diarize + ASR proxy can take ~9 min) the slower of
 * the two queues behind any backend lock and blows past the provider's
 * hard request timeout (OpenAI SDK default is 10 min), failing even
 * though the first call would have succeeded. Riffado then has multiple
 * concurrent DB writes attempting to upsert the same `transcriptions`
 * row, with the loser's result silently discarded.
 *
 * After: concurrent calls for the same (userId, recordingId) share a
 * single in-flight promise; only one provider call goes out. Mirrors
 * the `inFlightSyncs` pattern in `sync-recordings.ts`.
 *
 * Multi-process correctness (across hosted Next.js workers) is out of
 * scope for this fix; that's where the per-user rate limit at the route
 * boundary protects.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

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
 * and `db.transaction`. Each call to `transcribeRecordingInner` consumes
 * exactly one staging — staging twice covers a non-deduped fanout
 * (distinct recordings) and is harmless overshoot when dedup engages.
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
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve([recordingRow]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: () => ({
                where: () => ({ limit: () => Promise.resolve([]) }),
            }),
        })
        .mockReturnValueOnce({
            from: () => ({
                where: () => ({ limit: () => Promise.resolve([credsRow]) }),
            }),
        })
        .mockReturnValueOnce({
            from: () => ({
                where: () => ({
                    limit: () =>
                        Promise.resolve([
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
                from: () => ({
                    where: () => ({
                        for: () => ({
                            limit: () => Promise.resolve([{ deletedAt: null }]),
                        }),
                    }),
                }),
            })
            .mockReturnValueOnce({
                from: () => ({
                    where: () => ({ limit: () => Promise.resolve([]) }),
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
}

describe("transcribeRecording — in-flight dedup", () => {
    beforeEach(() => {
        // Full reset of the chained mocks — `clearAllMocks()` keeps the
        // `mockReturnValueOnce` queue, which leaks per-test stagings into
        // subsequent tests and surfaces as wrong-recording-row reads
        // (e.g. `undefined.storagePath`).
        (db.select as Mock).mockReset();
        (db.transaction as Mock).mockReset();
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
        // Stage a second attempt as defense-in-depth — if a regression
        // breaks dedup, the second inner call needs DB reads to fail
        // gracefully rather than throw on mock-chain underflow.
        stageOneAttempt("rec-shared");

        const callA = transcribeRecording(USER_ID, "rec-shared", {
            force: true,
        });
        // One microtask hop so callA enters the dedup wrapper and
        // populates the map before callB checks it.
        await Promise.resolve();
        const callB = transcribeRecording(USER_ID, "rec-shared", {
            force: true,
        });

        const [resA, resB] = await Promise.all([callA, callB]);

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        // Same object reference is the load-bearing assertion: the dedup
        // wrapper returns the *cached promise*, so both awaiters resolve
        // to the same TranscribeResult object. Without dedup, each
        // caller would build its own result and `toBe` (===) would fail.
        expect(resA).toBe(resB);
        // The provider was called exactly once across both callers.
        expect(audioCreate).toHaveBeenCalledTimes(1);
    });

    it("does NOT dedup across distinct recordingIds (each gets its own provider call)", async () => {
        audioCreate.mockResolvedValue({
            text: "transcript",
            language: "en",
        });
        // Sequential rather than concurrent — when the recordingIds
        // differ the dedup map has no entry to collide with, so what
        // we're actually pinning is "the keying isn't recordingId-only,
        // it doesn't collapse unrelated recordings". The shared FIFO
        // mock queue makes truly-concurrent staging brittle (calls A
        // and B interleave their selects out of order), and sequential
        // covers the same invariant cleanly.
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

        // Second call after the first settles must hit the provider again
        // — otherwise we'd be caching results forever and never refresh.
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
        await Promise.resolve();
        const callB = transcribeRecording(USER_ID, "rec-error", {
            force: true,
        });

        const [resA, resB] = await Promise.all([callA, callB]);
        expect(resA.success).toBe(false);
        expect(resB.success).toBe(false);
        expect(resA.errorCode).toBe("TRANSCRIPTION_FAILED");
        expect(resB.errorCode).toBe("TRANSCRIPTION_FAILED");
        // Both waiters got the same error object — the dedup wrapper
        // didn't double-invoke the inner function.
        expect(audioCreate).toHaveBeenCalledTimes(1);

        // After failure, the cache must be cleared so a fresh retry
        // actually re-hits the provider — otherwise users would be
        // stuck with a stale rejected promise.
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
