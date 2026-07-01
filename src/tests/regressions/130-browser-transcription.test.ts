/**
 * Regression: issue #130
 *
 * Background: the README and landing page advertised free in-browser
 * transcription (Transformers.js / Whisper in WebAssembly), but the
 * `BrowserTranscriber` class had zero callers and there was no route to
 * persist a client-produced transcript. Shipping the feature added
 * `storeBrowserTranscription`, which writes a browser transcript through
 * the same encrypted-at-rest path as the server one.
 *
 * These tests pin the storage contract: user-scoped lookup, browser
 * provider/type metadata, encrypted text, title generation, and webhook
 * emission -- plus the not-found guard.
 */

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
    decrypt: vi.fn().mockReturnValue("plaintext"),
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi
        .fn()
        .mockResolvedValue("Generated Title"),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

import { db } from "@/db";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { storeBrowserTranscription } from "@/lib/transcription/store-transcript";
import { emitEvent } from "@/lib/webhooks/emit";

const USER_ID = "user-123";
const RECORDING_ID = "rec-456";

function selectOnce(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
            }),
        }),
    };
}

describe("storeBrowserTranscription (issue #130)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns RECORDING_NOT_FOUND when the recording is missing or not owned", async () => {
        (db.select as Mock).mockReturnValueOnce(selectOnce([]));

        const result = await storeBrowserTranscription(USER_ID, RECORDING_ID, {
            text: "hello world",
            detectedLanguage: "en",
            model: "whisper-base",
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe("RECORDING_NOT_FOUND");
        expect(emitEvent).not.toHaveBeenCalled();
    });

    it("inserts an encrypted browser transcript, generates a title, and emits completion", async () => {
        // 1) recording lookup, 2) user settings lookup
        (db.select as Mock)
            .mockReturnValueOnce(
                selectOnce([
                    {
                        id: RECORDING_ID,
                        userId: USER_ID,
                        plaudFileId: "plaud-1",
                        deletedAt: null,
                    },
                ]),
            )
            .mockReturnValueOnce(
                selectOnce([
                    { autoGenerateTitle: true, syncTitleToPlaud: false },
                ]),
            );

        const txInsertValues = vi.fn().mockResolvedValue(undefined);
        const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });
        const txUpdate = vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        const tx = {
            select: vi
                .fn()
                // tombstone FOR UPDATE check
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
                // existing-transcription lookup (none)
                .mockReturnValueOnce(selectOnce([])),
            insert: txInsert,
            update: txUpdate,
        };
        (db.transaction as Mock).mockImplementation(
            async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
        );

        // title update goes through the top-level db.update
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });

        const result = await storeBrowserTranscription(USER_ID, RECORDING_ID, {
            text: "the quick brown fox",
            detectedLanguage: "en",
            model: "whisper-small",
        });

        expect(result.success).toBe(true);
        expect(result.text).toBe("the quick brown fox");

        expect(txInsert).toHaveBeenCalled();
        const inserted = txInsertValues.mock.calls[0][0];
        expect(inserted).toMatchObject({
            recordingId: RECORDING_ID,
            userId: USER_ID,
            transcriptionType: "browser",
            provider: "browser",
            model: "whisper-small",
            detectedLanguage: "en",
        });
        // Text is encrypted at rest (v1-prefixed ciphertext envelope).
        expect(inserted.text).toBe("v1:encrypted:the quick brown fox");

        expect(generateTitleFromTranscription).toHaveBeenCalledWith(
            USER_ID,
            "the quick brown fox",
        );
        expect(emitEvent).toHaveBeenCalledWith(
            "transcription.completed",
            USER_ID,
            RECORDING_ID,
        );
    });
});
