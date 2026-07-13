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
    const MockOpenAI = vi.fn(() => ({
        audio: {
            transcriptions: {
                create: vi.fn(),
            },
        },
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
    generateTitleFromTranscription: vi
        .fn()
        .mockResolvedValue("Generated Title"),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

import { OpenAI } from "openai";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import {
    storeBrowserTranscription,
    transcribeRecording,
} from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";

describe("Transcription", () => {
    const mockUserId = "user-123";
    const mockRecordingId = "rec-456";

    beforeEach(() => {
        vi.clearAllMocks();
        // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
        (OpenAI as unknown as Mock).mockImplementation(function () {
            return {
                audio: {
                    transcriptions: {
                        create: vi.fn(),
                    },
                },
            };
        });
    });

    describe("transcribeRecording", () => {
        it("should return error when recording not found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Recording not found");
        });

        it("should return success when transcription already exists", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { id: "trans-1", text: "Existing text" },
                                ]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
        });

        it("should return error when no API credentials configured", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
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
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("No transcription API configured");
        });

        it("fails fast (does not fall back to Mynah) when an explicit providerId override doesn't resolve", async () => {
            const { isMynahConfigured, transcribeViaMynah } = await import(
                "@/lib/hosted/transcription/mynah"
            );
            (isMynahConfigured as Mock).mockReturnValueOnce(true);

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
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
                // Explicit providerId lookup finds nothing (stale/invalid/other user's id).
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
                { providerId: "stale-provider-id" },
            );

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("NO_TRANSCRIPTION_PROVIDER");
            expect(transcribeViaMynah).not.toHaveBeenCalled();
        });

        it("should return error when API call fails", async () => {
            const mockCreate = vi
                .fn()
                .mockRejectedValue(new Error("API Error"));
            // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
            (OpenAI as unknown as Mock).mockImplementation(function () {
                return {
                    audio: { transcriptions: { create: mockCreate } },
                };
            });

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
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
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([{ id: "settings-1" }]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("API Error");
        });

        it("bumps recording updatedAt and emits completion after generated title is stored", async () => {
            const mockCreate = vi.fn().mockResolvedValue({
                text: "Fresh transcript",
                language: "en",
            });
            // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
            (OpenAI as unknown as Mock).mockImplementation(function () {
                return {
                    audio: { transcriptions: { create: mockCreate } },
                };
            });
            (generateTitleFromTranscription as Mock).mockResolvedValue(
                "Generated Title",
            );

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    userId: mockUserId,
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
                            limit: vi.fn().mockResolvedValue([
                                {
                                    autoGenerateTitle: true,
                                    syncTitleToPlaud: false,
                                },
                            ]),
                        }),
                    }),
                });

            const txInsertValues = vi.fn().mockResolvedValue(undefined);
            const txInsert = vi.fn().mockReturnValue({
                values: txInsertValues,
            });
            const recordingBumpWhere = vi.fn().mockResolvedValue(undefined);
            const recordingBumpSet = vi.fn().mockReturnValue({
                where: recordingBumpWhere,
            });
            const txUpdate = vi.fn().mockReturnValue({
                set: recordingBumpSet,
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
                                        .mockResolvedValue([
                                            { deletedAt: null },
                                        ]),
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
                async (
                    callback: (
                        transaction: typeof tx,
                    ) => Promise<unknown> | unknown,
                ) => callback(tx),
            );

            const titleUpdateWhere = vi.fn().mockResolvedValue(undefined);
            const titleUpdateSet = vi.fn().mockReturnValue({
                where: titleUpdateWhere,
            });
            (db.update as Mock).mockReturnValue({
                set: titleUpdateSet,
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
            expect(txInsert).toHaveBeenCalled();
            expect(txUpdate).toHaveBeenCalledWith(recordings);
            expect(recordingBumpSet).toHaveBeenCalledWith({
                updatedAt: expect.any(Date),
            });
            expect(titleUpdateSet).toHaveBeenCalledWith({
                filename: "v1:encrypted:Generated Title",
                updatedAt: expect.any(Date),
            });
            expect(emitEvent).toHaveBeenCalledWith(
                "transcription.completed",
                mockUserId,
                mockRecordingId,
            );
            expect(
                (emitEvent as Mock).mock.invocationCallOrder[0],
            ).toBeGreaterThan(titleUpdateWhere.mock.invocationCallOrder[0]);
        });
    });

    describe("storeBrowserTranscription", () => {
        function mockOwnershipLookup(rows: unknown[]) {
            (db.select as Mock).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(rows),
                    }),
                }),
            });
        }

        function makeTxMock(opts: {
            stillActive: { deletedAt: Date | null } | null;
            existingTranscription: { id: string } | null;
        }) {
            const txInsertValues = vi.fn().mockResolvedValue(undefined);
            const txInsert = vi
                .fn()
                .mockReturnValue({ values: txInsertValues });
            const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
            const txUpdateSet = vi
                .fn()
                .mockReturnValue({ where: txUpdateWhere });
            const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

            const tx = {
                select: vi
                    .fn()
                    .mockReturnValueOnce({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                for: vi.fn().mockReturnValue({
                                    limit: vi
                                        .fn()
                                        .mockResolvedValue(
                                            opts.stillActive
                                                ? [opts.stillActive]
                                                : [],
                                        ),
                                }),
                            }),
                        }),
                    })
                    .mockReturnValueOnce({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                limit: vi
                                    .fn()
                                    .mockResolvedValue(
                                        opts.existingTranscription
                                            ? [opts.existingTranscription]
                                            : [],
                                    ),
                            }),
                        }),
                    }),
                insert: txInsert,
                update: txUpdate,
            };
            (db.transaction as Mock).mockImplementation(
                async (
                    callback: (
                        transaction: typeof tx,
                    ) => Promise<unknown> | unknown,
                ) => callback(tx),
            );
            return { tx, txInsert, txInsertValues, txUpdate, txUpdateSet };
        }

        it("returns HOSTED_LOCKED_OUT (not TRANSCRIPTION_FAILED) when the account is lapsed", async () => {
            const { isHostedLockedOut } = await import("@/lib/entitlements");
            (isHostedLockedOut as Mock).mockResolvedValueOnce(true);
            const result = await storeBrowserTranscription({
                userId: mockUserId,
                recordingId: mockRecordingId,
                text: "hello world",
                detectedLanguage: "en",
                model: "whisper-base",
            });
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("HOSTED_LOCKED_OUT");
            expect(emitEvent).not.toHaveBeenCalled();
        });

        it("returns RECORDING_NOT_FOUND when recording does not exist or is tombstoned", async () => {
            mockOwnershipLookup([]);
            const result = await storeBrowserTranscription({
                userId: mockUserId,
                recordingId: mockRecordingId,
                text: "hello world",
                detectedLanguage: "en",
                model: "whisper-base",
            });
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("RECORDING_NOT_FOUND");
            expect(emitEvent).not.toHaveBeenCalled();
        });

        it("returns RECORDING_DELETED when the row is tombstoned mid-transaction", async () => {
            mockOwnershipLookup([{ id: mockRecordingId, deletedAt: null }]);
            makeTxMock({
                stillActive: { deletedAt: new Date() },
                existingTranscription: null,
            });
            const result = await storeBrowserTranscription({
                userId: mockUserId,
                recordingId: mockRecordingId,
                text: "hello world",
                detectedLanguage: "en",
                model: "whisper-base",
            });
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("RECORDING_DELETED");
            expect(emitEvent).not.toHaveBeenCalled();
        });

        it("inserts a new transcription row with type='browser' and provider='browser' (model preserved)", async () => {
            mockOwnershipLookup([{ id: mockRecordingId, deletedAt: null }]);
            const harness = makeTxMock({
                stillActive: { deletedAt: null },
                existingTranscription: null,
            });

            const result = await storeBrowserTranscription({
                userId: mockUserId,
                recordingId: mockRecordingId,
                text: "new transcript text",
                detectedLanguage: "fr",
                model: "whisper-base",
            });

            expect(result.success).toBe(true);
            expect(result.text).toBe("new transcript text");
            expect(result.detectedLanguage).toBe("fr");
            expect(harness.txInsert).toHaveBeenCalled();
            const inserted = harness.txInsertValues.mock.calls[0][0] as Record<
                string,
                unknown
            >;
            expect(inserted.transcriptionType).toBe("browser");
            expect(inserted.provider).toBe("browser");
            expect(inserted.model).toBe("whisper-base");
            expect(inserted.detectedLanguage).toBe("fr");
            // Text is at-rest-encrypted before storage.
            expect(inserted.text).toBe("v1:encrypted:new transcript text");
            expect(emitEvent).toHaveBeenCalledWith(
                "transcription.completed",
                mockUserId,
                mockRecordingId,
            );
        });

        it("updates an existing transcription row (idempotent re-run)", async () => {
            mockOwnershipLookup([{ id: mockRecordingId, deletedAt: null }]);
            const harness = makeTxMock({
                stillActive: { deletedAt: null },
                existingTranscription: { id: "trans-existing" },
            });

            const result = await storeBrowserTranscription({
                userId: mockUserId,
                recordingId: mockRecordingId,
                text: "updated transcript",
                detectedLanguage: null,
                model: "whisper-small",
            });

            expect(result.success).toBe(true);
            expect(harness.txInsert).not.toHaveBeenCalled();
            expect(harness.txUpdate).toHaveBeenCalled();
            const updated = harness.txUpdateSet.mock.calls[0][0] as Record<
                string,
                unknown
            >;
            expect(updated.transcriptionType).toBe("browser");
            expect(updated.provider).toBe("browser");
            expect(updated.model).toBe("whisper-small");
            expect(updated.detectedLanguage).toBeNull();
            expect(emitEvent).toHaveBeenCalledWith(
                "transcription.completed",
                mockUserId,
                mockRecordingId,
            );
        });
    });
});
