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
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
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
                filename: "Generated Title",
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
});
