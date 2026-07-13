/**
 * Regression: issue #122
 *
 * Background: OpenRouter doesn't implement `/v1/audio/transcriptions`.
 * Before this fix, transcribing with an OpenRouter credential POSTed
 * multipart audio to that 404 endpoint and crashed inside the OpenAI
 * SDK's response parser ("No number after minus sign in JSON…").
 *
 * After the fix, providers with `transcriptionStyle: "chat"` route
 * through `chat.completions.create` with an `input_audio` content part.
 * The recording's transcription row is written from the chat response
 * text exactly as for the Whisper path.
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

describe("issue #122 — OpenRouter transcription uses chat-completions", () => {
    const userId = "user-122";
    const recordingId = "rec-122";

    beforeEach(() => {
        vi.clearAllMocks();
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

    it("routes OpenRouter credentials through chat.completions and never hits /audio/transcriptions", async () => {
        chatCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: "this is the transcript from openrouter",
                    },
                },
            ],
        });

        (db.select as Mock)
            // recording lookup
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                id: recordingId,
                                userId,
                                plaudFileId: "plaud-1",
                                filename: "Some Recording",
                                storagePath: "rec-122.mp3",
                                deletedAt: null,
                            },
                        ]),
                    }),
                }),
            })
            // existing transcription
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            })
            // credentials
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                id: "creds-1",
                                provider: "OpenRouter",
                                apiKey: "encrypted-key",
                                baseUrl: "https://openrouter.ai/api/v1",
                                defaultModel: "google/gemini-2.5-flash-lite",
                            },
                        ]),
                    }),
                }),
            })
            // settings
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                autoGenerateTitle: false,
                                syncTitleToPlaud: false,
                                transcriptionQuality: "balanced",
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
        (db.transaction as Mock).mockImplementation(
            async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
        );

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        expect(audioCreate).not.toHaveBeenCalled();
        expect(chatCreate).toHaveBeenCalledTimes(1);

        const chatArgs = chatCreate.mock.calls[0]?.[0];
        expect(chatArgs?.model).toBe("google/gemini-2.5-flash-lite");
        const contentParts = chatArgs?.messages?.[0]?.content as Array<{
            type: string;
            input_audio?: { format: string; data: string };
        }>;
        expect(Array.isArray(contentParts)).toBe(true);
        const audioPart = contentParts.find((p) => p.type === "input_audio");
        expect(audioPart?.input_audio?.format).toBe("mp3");
        expect(typeof audioPart?.input_audio?.data).toBe("string");
        expect(audioPart?.input_audio?.data.length).toBeGreaterThan(0);
    });

    it("returns an actionable error when the audio is opus (chat-style providers can't accept it)", async () => {
        (db.select as Mock)
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                id: recordingId,
                                userId,
                                plaudFileId: "plaud-1",
                                filename: "Opus upload",
                                storagePath: "rec-122.opus",
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
                                provider: "OpenRouter",
                                apiKey: "encrypted-key",
                                baseUrl: "https://openrouter.ai/api/v1",
                                defaultModel: "google/gemini-2.5-flash-lite",
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
                                autoGenerateTitle: false,
                                syncTitleToPlaud: false,
                                transcriptionQuality: "balanced",
                            },
                        ]),
                    }),
                }),
            });

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/mp3|wav/i);
        expect(chatCreate).not.toHaveBeenCalled();
    });
});
