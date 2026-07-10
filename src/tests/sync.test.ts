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

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/db";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

describe("Sync", () => {
    const mockUserId = "user-123";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("syncRecordingsForUser", () => {
        it("should return error when no Plaud connection found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.errors).toContain("No Plaud connection found");
            expect(result.newRecordings).toBe(0);
        });

        it("should skip already synced recordings with same version", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            const mockExistingRecording = {
                id: "local-rec-1",
                plaudFileId: "plaud-1",
                plaudVersion: "1000",
            };

            const mockPlaudRecordings = [
                {
                    id: "plaud-1",
                    filename: "Recording 1.mp3",
                    duration: 60000,
                    start_time: "2024-01-01T10:00:00Z",
                    end_time: "2024-01-01T10:01:00Z",
                    filesize: 1024000,
                    file_md5: "abc123",
                    serial_number: "SN123",
                    version_ms: 1000,
                    timezone: 0,
                    zonemins: 0,
                    scene: 0,
                    is_trash: false,
                },
            ];

            const mockPlaudClient = {
                listFiletags: vi
                    .fn()
                    .mockResolvedValue({ status: 0, data_filetag_list: [] }),
                getRecordings: vi.fn().mockResolvedValue({
                    data_file_list: mockPlaudRecordings,
                }),
                downloadRecording: vi
                    .fn()
                    .mockResolvedValue(Buffer.from("audio")),
            };

            (createPlaudClient as Mock).mockResolvedValue(mockPlaudClient);

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                })
                // filetag mirror load (sync-filetags): awaited at .where()
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([mockExistingRecording]),
                        }),
                    }),
                });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.newRecordings).toBe(0);
            expect(result.updatedRecordings).toBe(0);
        });

        it("should update recordings with newer version", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            const mockExistingRecording = {
                id: "local-rec-1",
                plaudFileId: "plaud-1",
                plaudVersion: "500",
            };

            const mockPlaudRecordings = [
                {
                    id: "plaud-1",
                    filename: "Recording 1.mp3",
                    duration: 60000,
                    start_time: "2024-01-01T10:00:00Z",
                    end_time: "2024-01-01T10:01:00Z",
                    filesize: 1024000,
                    file_md5: "abc123",
                    serial_number: "SN123",
                    version_ms: 2000,
                    timezone: 0,
                    zonemins: 0,
                    scene: 0,
                    is_trash: false,
                },
            ];

            const mockPlaudClient = {
                listFiletags: vi
                    .fn()
                    .mockResolvedValue({ status: 0, data_filetag_list: [] }),
                getRecordings: vi.fn().mockResolvedValue({
                    data_file_list: mockPlaudRecordings,
                }),
                downloadRecording: vi
                    .fn()
                    .mockResolvedValue(Buffer.from("audio")),
            };

            (createPlaudClient as Mock).mockResolvedValue(mockPlaudClient);

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                })
                // filetag mirror load (sync-filetags): awaited at .where()
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([mockExistingRecording]),
                        }),
                    }),
                });

            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // sync-recordings now wraps the update path in a transaction
            // that re-checks the tombstone under FOR UPDATE before writing.
            // Stub the tx so the inner select returns a non-tombstoned row
            // and the inner update resolves; cb returns true so the caller
            // proceeds to emit `recording.updated`.
            (db.transaction as Mock).mockImplementation(
                async (cb: (tx: unknown) => Promise<boolean>) => {
                    const tx = {
                        select: vi.fn().mockReturnValue({
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
                        }),
                        update: vi.fn().mockReturnValue({
                            set: vi.fn().mockReturnValue({
                                where: vi.fn().mockResolvedValue(undefined),
                            }),
                        }),
                    };
                    return cb(tx);
                },
            );

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.newRecordings).toBe(0);
            expect(result.updatedRecordings).toBe(1);
        });

        it("should return error when sync fails", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                });

            (createPlaudClient as Mock).mockRejectedValue(
                new Error("Connection failed"),
            );

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
});
