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
 * auto-transcribe set. It does not cover Retry double-click.
 * This map is complementary, not a substitute.
 *
 * Equivalent-option calls for the same (userId, recordingId, force)
 * share one in-flight promise. Force is partitioned from non-force so
 * Retry cannot inherit an auto-transcribe idempotent skip.
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
import { isHostedLockedOut } from "@/lib/entitlements";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

const USER_ID = "user-dedup";

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/**
 * Concurrent-safe stub: every `db.select` returns the same union row so
 * interleaved inners do not consume a FIFO Once-queue out of order.
 * `existingText` makes the idempotent skip fire for non-force callers.
 */
function installSelectStub(opts: { existingText?: string } = {}) {
    const row = {
        id: "row-1",
        userId: USER_ID,
        plaudFileId: "plaud-1",
        filename: "Some Recording",
        storagePath: "rec.mp3",
        deletedAt: null,
        text: opts.existingText,
        detectedLanguage: opts.existingText ? "en" : null,
        provider: "OpenAI",
        apiKey: "encrypted-key",
        baseUrl: null,
        defaultModel: "whisper-1",
        autoGenerateTitle: false,
        syncTitleToPlaud: false,
        transcriptionQuality: "balanced",
        defaultTranscriptionLanguage: null,
    };

    (db.select as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([row]),
            }),
        }),
    });

    const tx = {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    for: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ deletedAt: null }]),
                    }),
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
    (db.transaction as Mock).mockImplementation(
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
        (isHostedLockedOut as Mock).mockReset();
        (isHostedLockedOut as Mock).mockResolvedValue(false);
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
        installSelectStub();

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

    it("does not let a force Retry inherit an in-flight auto-transcribe skip", async () => {
        const lockout = createDeferred<boolean>();
        (isHostedLockedOut as Mock)
            .mockImplementationOnce(() => lockout.promise)
            .mockResolvedValue(false);
        audioCreate.mockResolvedValue({
            text: "forced retranscription",
            language: "en",
        });
        installSelectStub({ existingText: "already transcribed" });

        const auto = transcribeRecording(USER_ID, "rec-skip", {
            trigger: "sync",
        });
        await Promise.resolve();

        const retry = transcribeRecording(USER_ID, "rec-skip", {
            force: true,
            trigger: "manual",
        });
        await vi.waitFor(() => expect(audioCreate).toHaveBeenCalledTimes(1));

        lockout.resolve(false);
        const [autoRes, retryRes] = await Promise.all([auto, retry]);

        expect(autoRes.success).toBe(true);
        expect(autoRes.text).toBe("already transcribed");
        expect(retryRes.success).toBe(true);
        expect(retryRes.text).toBe("forced retranscription");
        expect(retryRes).not.toBe(autoRes);
        expect(audioCreate).toHaveBeenCalledTimes(1);
    });

    it("does NOT dedup across distinct recordingIds (each gets its own provider call)", async () => {
        const gate = createDeferred<{ text: string; language: string }>();
        audioCreate.mockReturnValue(gate.promise);
        installSelectStub();

        const callA = transcribeRecording(USER_ID, "rec-a", {
            force: true,
        });
        const callB = transcribeRecording(USER_ID, "rec-b", {
            force: true,
        });
        await vi.waitFor(() => expect(audioCreate).toHaveBeenCalledTimes(2));

        gate.resolve({ text: "transcript", language: "en" });
        const [resA, resB] = await Promise.all([callA, callB]);

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("does NOT dedup across distinct users even with the same recordingId (key namespaces by userId)", async () => {
        const gate = createDeferred<{ text: string; language: string }>();
        audioCreate.mockReturnValue(gate.promise);
        installSelectStub();

        const callA = transcribeRecording("user-a", "rec-shared-id", {
            force: true,
        });
        const callB = transcribeRecording("user-b", "rec-shared-id", {
            force: true,
        });
        await vi.waitFor(() => expect(audioCreate).toHaveBeenCalledTimes(2));

        gate.resolve({ text: "transcript", language: "en" });
        const [resA, resB] = await Promise.all([callA, callB]);

        expect(resA.success).toBe(true);
        expect(resB.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("clears the in-flight cache after the promise settles so a follow-up call re-runs", async () => {
        audioCreate.mockResolvedValue({
            text: "first call",
            language: "en",
        });
        installSelectStub();
        const first = await transcribeRecording(USER_ID, "rec-followup", {
            force: true,
        });
        expect(first.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(1);

        audioCreate.mockResolvedValue({
            text: "second call",
            language: "en",
        });
        const second = await transcribeRecording(USER_ID, "rec-followup", {
            force: true,
        });
        expect(second.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });

    it("propagates errors to all concurrent waiters and still clears the cache for a fresh retry", async () => {
        audioCreate.mockRejectedValueOnce(new Error("upstream 500"));
        installSelectStub();

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
        const retry = await transcribeRecording(USER_ID, "rec-error", {
            force: true,
        });
        expect(retry.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(2);
    });
});
