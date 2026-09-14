/**
 * Integration: `transcribeRecording` routes an "ElevenLabs" credential to
 * `elevenLabsTranscribe` instead of the OpenAI SDK, skips the
 * Whisper-only compression step, and forwards the diarization settings.
 */

import { Readable } from "node:stream";
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
        downloadStream: vi
            .fn()
            .mockImplementation(async () =>
                Readable.from([Buffer.from("fake-mp3-bytes")]),
            ),
    }),
}));

const {
    openaiConstructed,
    elevenLabsTranscribeMock,
    compressMock,
    downloadFileWithLimitMock,
} = vi.hoisted(() => ({
    openaiConstructed: vi.fn(),
    elevenLabsTranscribeMock: vi.fn(),
    compressMock: vi.fn(),
    downloadFileWithLimitMock: vi.fn(),
}));

vi.mock("openai", () => {
    const MockOpenAI = vi.fn(function (this: unknown, ...args: unknown[]) {
        openaiConstructed(...args);
        return {
            audio: { transcriptions: { create: vi.fn() } },
            chat: { completions: { create: vi.fn() } },
        };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/transcription/elevenlabs-transcribe", async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import("@/lib/transcription/elevenlabs-transcribe")
        >();
    return {
        ...actual,
        elevenLabsTranscribe: elevenLabsTranscribeMock,
    };
});

vi.mock("@/lib/transcription/compress-audio", () => ({
    maybeCompressForWhisper: compressMock,
}));

vi.mock("@/lib/storage/download-limited", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/lib/storage/download-limited")>();
    downloadFileWithLimitMock.mockImplementation(actual.downloadFileWithLimit);
    return {
        ...actual,
        downloadFileWithLimit: downloadFileWithLimitMock,
    };
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

import { db } from "@/db";
import { DownloadSizeLimitError } from "@/lib/storage/download-limited";
import { ELEVENLABS_MAX_FILE_BYTES } from "@/lib/transcription/elevenlabs-transcribe";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

const userId = "user-el";
const recordingId = "rec-el";

function mockRecordingFlow(
    settingsOverrides: Record<string, unknown> = {},
    opts: {
        rawSettingsRow?: Record<string, unknown>;
        recordingOverrides?: Record<string, unknown>;
    } = {},
) {
    const recordingRow = {
        id: recordingId,
        userId,
        plaudFileId: "plaud-1",
        filename: "Some Recording",
        storagePath: "rec-el.mp3",
        filesize: 1024,
        deletedAt: null,
        ...opts.recordingOverrides,
    };
    const credsRow = {
        id: "creds-el",
        provider: "ElevenLabs",
        apiKey: "encrypted-key",
        baseUrl: null,
        defaultModel: "scribe_v2",
    };

    const settingsRow = opts.rawSettingsRow ?? {
        autoGenerateTitle: false,
        syncTitleToPlaud: false,
        transcriptionQuality: "balanced",
        defaultTranscriptionLanguage: null,
        speakerDiarization: true,
        diarizationSpeakerCount: null,
        ...settingsOverrides,
    };

    (db.select as Mock)
        // recording lookup
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([recordingRow]),
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
                    limit: vi.fn().mockResolvedValue([credsRow]),
                }),
            }),
        })
        // user settings
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([settingsRow]),
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
        insertValues: vi.fn().mockResolvedValue(undefined),
        insert: undefined as unknown as Mock,
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
    };
    tx.insert = vi.fn().mockReturnValue({ values: tx.insertValues });
    (db.transaction as Mock).mockImplementation(
        async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );
    (db.delete as Mock).mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
    });
    return tx;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("transcribeRecording -- ElevenLabs routing", () => {
    it("calls elevenLabsTranscribe and never constructs the OpenAI client", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "Speaker 1: hallo\nSpeaker 2: guten tag",
            detectedLanguage: "de",
            speakerCount: 2,
        });
        mockRecordingFlow();

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        expect(result.text).toBe("Speaker 1: hallo\nSpeaker 2: guten tag");
        expect(elevenLabsTranscribeMock).toHaveBeenCalledOnce();
        expect(openaiConstructed).not.toHaveBeenCalled();
    });

    it("never runs the Whisper-only compression step", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: null,
            speakerCount: 0,
        });
        mockRecordingFlow();

        await transcribeRecording(userId, recordingId);

        expect(compressMock).not.toHaveBeenCalled();
    });

    it("passes diarize: true by default and language: undefined when auto-detect is set", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: "en",
            speakerCount: 0,
        });
        mockRecordingFlow();

        await transcribeRecording(userId, recordingId);

        const args = elevenLabsTranscribeMock.mock.calls[0][0];
        expect(args.diarize).toBe(true);
        expect(args.language).toBeUndefined();
        expect(args.model).toBe("scribe_v2");
    });

    it("forwards an explicitly selected language", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: "de",
            speakerCount: 0,
        });
        mockRecordingFlow({ defaultTranscriptionLanguage: "de" });

        await transcribeRecording(userId, recordingId);

        const args = elevenLabsTranscribeMock.mock.calls[0][0];
        expect(args.language).toBe("de");
    });

    it("normalizes an empty-string language to undefined", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: null,
            speakerCount: 0,
        });
        mockRecordingFlow({ defaultTranscriptionLanguage: "" });

        await transcribeRecording(userId, recordingId);

        const args = elevenLabsTranscribeMock.mock.calls[0][0];
        expect(args.language).toBeUndefined();
    });

    it("passes diarize: false and the speaker-count hint when set", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: null,
            speakerCount: 0,
        });
        mockRecordingFlow({
            speakerDiarization: false,
            diarizationSpeakerCount: 3,
        });

        await transcribeRecording(userId, recordingId);

        const args = elevenLabsTranscribeMock.mock.calls[0][0];
        expect(args.diarize).toBe(false);
        expect(args.numSpeakers).toBe(3);
    });

    it("persists the diarized transcript text via upsertTranscription", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "Speaker 1: hallo\nSpeaker 2: guten tag",
            detectedLanguage: "de",
            speakerCount: 2,
        });
        const tx = mockRecordingFlow();

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        // upsertTranscription (real, unmocked) inserts the new row inside
        // the transaction since no existing 'riffado' row was found.
        const insertValues = tx.insertValues.mock.calls[0][0];
        // encryptText mock above is `(v) => enc:${v}`.
        expect(insertValues).toMatchObject({
            recordingId,
            userId,
            text: "enc:Speaker 1: hallo\nSpeaker 2: guten tag",
            detectedLanguage: "de",
            provider: "ElevenLabs",
            model: "scribe_v2",
            source: "riffado",
        });
    });

    it("defaults diarize to true, numSpeakers to undefined, and language to undefined when the settings row omits all three fields", async () => {
        elevenLabsTranscribeMock.mockResolvedValue({
            text: "plain",
            detectedLanguage: null,
            speakerCount: 0,
        });
        mockRecordingFlow(
            {},
            {
                rawSettingsRow: {
                    autoGenerateTitle: false,
                    syncTitleToPlaud: false,
                    transcriptionQuality: "balanced",
                    // defaultTranscriptionLanguage / speakerDiarization /
                    // diarizationSpeakerCount intentionally omitted --
                    // exercises the `|| undefined` / `?? true` /
                    // `?? undefined` fallbacks in transcribe-recording.ts.
                },
            },
        );

        await transcribeRecording(userId, recordingId);

        const args = elevenLabsTranscribeMock.mock.calls[0][0];
        expect(args.diarize).toBe(true);
        expect(args.numSpeakers).toBeUndefined();
        expect(args.language).toBeUndefined();
    });

    it("returns errorCode FILE_TOO_LARGE without calling elevenLabsTranscribe when the recorded filesize exceeds the cap", async () => {
        mockRecordingFlow(
            {},
            {
                recordingOverrides: {
                    filesize: ELEVENLABS_MAX_FILE_BYTES + 1,
                },
            },
        );

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe("FILE_TOO_LARGE");
        expect(elevenLabsTranscribeMock).not.toHaveBeenCalled();
    });

    it("uses a size-independent message when the stream exceeds the cap despite a small recorded filesize", async () => {
        downloadFileWithLimitMock.mockRejectedValueOnce(
            new DownloadSizeLimitError(ELEVENLABS_MAX_FILE_BYTES),
        );
        mockRecordingFlow(
            {},
            {
                recordingOverrides: {
                    filesize: 0,
                },
            },
        );

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe("FILE_TOO_LARGE");
        expect(result.error).not.toContain("(0 MB)");
        expect(result.error).toBe(
            `Audio file exceeds the ${ELEVENLABS_MAX_FILE_BYTES / 1024 / 1024} MB limit for ElevenLabs transcription.`,
        );
        expect(elevenLabsTranscribeMock).not.toHaveBeenCalled();
    });
});
