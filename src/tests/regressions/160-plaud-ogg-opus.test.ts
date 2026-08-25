/**
 * Regression: issue #160
 *
 * Plaud labels downloads `.mp3` and Riffado used to store them as
 * `audio/mpeg`, but the bytes are Ogg/Opus (`OggS`, vendor PALUD.AI).
 * OpenRouter chat-style transcription then rejected `audio/ogg`.
 *
 * After the fix:
 *   1. Container/codec come from magic bytes, not the filename.
 *   2. Sync stores the sniffed extension + MIME.
 *   3. Chat providers transcode unsupported audio to mp3 via the same
 *      ffmpeg binary already used for Whisper size compression.
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
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

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/hosted/billing/storage-cap", () => ({
    enforceStorageCap: vi.fn().mockResolvedValue({
        allowed: true,
        currentBytes: 0,
        limitBytes: null,
    }),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
        deleteFile: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));

import { db } from "@/db";
import { sniffAudio } from "@/lib/audio/sniff";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import { buildAudioFile } from "@/lib/transcription/audio-file";
import { chatTranscribe } from "@/lib/transcription/chat-transcribe";
import { ffmpegToOpus, transcodeToMp3 } from "@/lib/transcription/ffmpeg";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.mp3");

function hasFfmpeg(): boolean {
    const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return probe.status === 0;
}

function oggOpusBytes(): Buffer {
    const buf = Buffer.alloc(48, 0);
    buf.write("OggS", 0);
    buf.write("OpusHead", 28);
    return buf;
}

const itIfFfmpeg = hasFfmpeg() ? it : it.skip;

describe("issue #160 — Plaud .mp3 that is actually Ogg/Opus", () => {
    it("buildAudioFile sniffs Ogg bytes even when the path is .mp3", () => {
        const { file, contentType } = buildAudioFile(
            oggOpusBytes(),
            "user-1/2026-05-19 18-06-54.mp3",
            "2026-05-19 18-06-54.mp3",
        );
        expect(contentType).toBe("audio/ogg");
        expect(file.type).toBe("audio/ogg");
        expect(file.name).toBe("2026-05-19 18-06-54.ogg");
    });

    describe("sync stores sniffed container, not the Plaud filename", () => {
        const mockUserId = "user-160";
        const oggBuffer = oggOpusBytes();

        const mockPlaudRecording = {
            id: "plaud-160",
            filename: "2026-05-19 18-06-54.mp3",
            duration: 6500,
            start_time: "2026-05-19T18:06:54Z",
            end_time: "2026-05-19T18:07:00Z",
            filesize: oggBuffer.length,
            file_md5: "oggmd5",
            serial_number: "SN160",
            version_ms: 9999,
            timezone: 0,
            zonemins: 0,
            scene: 0,
            is_trash: false,
        };

        beforeEach(() => {
            vi.clearAllMocks();
        });

        async function storageMock() {
            const storage = (await createUserStorageProvider(
                mockUserId,
            )) as unknown as {
                uploadFile: Mock;
                deleteFile: Mock;
            };
            storage.uploadFile.mockClear();
            storage.deleteFile.mockClear();
            return storage;
        }

        function stubPlaud() {
            (createPlaudClient as Mock).mockResolvedValue({
                getRecordings: vi.fn().mockResolvedValue({
                    data_file_list: [mockPlaudRecording],
                }),
                downloadRecording: vi.fn().mockResolvedValue(oggBuffer),
            });
        }

        function stubSelects(results: unknown[][]) {
            const chain = (db.select as Mock).mockReset();
            for (const result of results) {
                chain.mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(result),
                        }),
                    }),
                });
            }
        }

        it("stores a new Plaud Ogg/Opus download as audio/ogg with a .ogg key", async () => {
            const storage = await storageMock();
            stubPlaud();
            stubSelects([
                [{ id: "conn-1", userId: mockUserId, bearerToken: "tok" }],
                [{ id: "settings-1" }],
                [{ email: "t@example.com" }],
                [],
                [],
            ]);

            (db.insert as Mock).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: "new-rec" }]),
                }),
            });
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.newRecordings).toBe(1);
            expect(result.errors).toEqual([]);
            expect(storage.uploadFile).toHaveBeenCalledTimes(1);
            const [key, body, contentType] = storage.uploadFile.mock.calls[0];
            expect(key).toMatch(/\.ogg$/);
            expect(body).toBe(oggBuffer);
            expect(contentType).toBe("audio/ogg");
            expect(storage.deleteFile).not.toHaveBeenCalled();
        });

        function stubUpdateTransaction() {
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
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });
        }

        it("re-syncs Ogg/Opus onto the existing key with an honest MIME", async () => {
            const oldPath = "user-160/2026-05-19 18-06-54.mp3.mp3";
            const storage = await storageMock();
            stubPlaud();
            stubSelects([
                [{ id: "conn-1", userId: mockUserId, bearerToken: "tok" }],
                [{ id: "settings-1" }],
                [{ email: "t@example.com" }],
                [
                    {
                        id: "local-rec-160",
                        plaudFileId: "plaud-160",
                        plaudVersion: "1",
                        storagePath: oldPath,
                        deletedAt: null,
                    },
                ],
                [],
            ]);
            stubUpdateTransaction();

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.updatedRecordings).toBe(1);
            expect(result.errors).toEqual([]);
            expect(storage.uploadFile).toHaveBeenCalledWith(
                oldPath,
                oggBuffer,
                "audio/ogg",
            );
            expect(storage.deleteFile).not.toHaveBeenCalled();
        });

        it("allocates a new key when another row still shares storagePath", async () => {
            const sharedPath = "user-160/2026-05-19 18-06-54.mp3.mp3";
            const storage = await storageMock();
            stubPlaud();
            stubSelects([
                [{ id: "conn-1", userId: mockUserId, bearerToken: "tok" }],
                [{ id: "settings-1" }],
                [{ email: "t@example.com" }],
                [
                    {
                        id: "local-rec-160",
                        plaudFileId: "plaud-160",
                        plaudVersion: "1",
                        storagePath: sharedPath,
                        deletedAt: null,
                    },
                ],
                [{ id: "other-rec" }],
                [],
            ]);
            stubUpdateTransaction();

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.updatedRecordings).toBe(1);
            expect(result.errors).toEqual([]);
            expect(storage.uploadFile).toHaveBeenCalledTimes(1);
            const [key, body, contentType] = storage.uploadFile.mock.calls[0];
            expect(key).not.toBe(sharedPath);
            expect(key).toMatch(/\.ogg$/);
            expect(body).toBe(oggBuffer);
            expect(contentType).toBe("audio/ogg");
            expect(storage.deleteFile).not.toHaveBeenCalled();
        });
    });

    itIfFfmpeg(
        "transcodes Ogg/Opus to mp3 before OpenRouter chat.completions",
        async () => {
            const fixture = await readFile(FIXTURE);
            const ogg = await ffmpegToOpus(fixture, 16);
            expect(sniffAudio(ogg).container).toBe("ogg");

            const chatCreate = vi.fn().mockResolvedValue({
                choices: [{ message: { content: "hello from openrouter" } }],
            });

            const result = await chatTranscribe({
                client: {
                    chat: { completions: { create: chatCreate } },
                } as never,
                model: "google/gemini-2.5-flash-lite",
                audioBuffer: ogg,
                contentType: "audio/mpeg",
                language: "en",
            });

            expect(result.text).toBe("hello from openrouter");
            expect(chatCreate).toHaveBeenCalledTimes(1);
            const contentParts = chatCreate.mock.calls[0]?.[0]?.messages?.[0]
                ?.content as Array<{
                type: string;
                input_audio?: { format: string; data: string };
            }>;
            const audioPart = contentParts.find(
                (p) => p.type === "input_audio",
            );
            expect(audioPart?.input_audio?.format).toBe("mp3");
            const sent = Buffer.from(
                audioPart?.input_audio?.data ?? "",
                "base64",
            );
            expect(sniffAudio(sent).container).toBe("mp3");
            expect(sent.equals(ogg)).toBe(false);
        },
        20_000,
    );

    itIfFfmpeg(
        "transcodeToMp3 writes a real MPEG stream",
        async () => {
            const fixture = await readFile(FIXTURE);
            const ogg = await ffmpegToOpus(fixture, 16);
            const mp3 = await transcodeToMp3(ogg);
            expect(sniffAudio(mp3).container).toBe("mp3");
            expect(mp3.length).toBeGreaterThan(0);
        },
        15_000,
    );
});
