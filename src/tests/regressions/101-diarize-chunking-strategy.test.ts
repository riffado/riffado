/**
 * Regression: issue #101
 *
 * Before this fix, transcribing with `gpt-4o-transcribe-diarize` (or any
 * model whose name contains "diarize") failed at the OpenAI API boundary
 * with HTTP 400:
 *   `chunking_strategy is required for diarization models`
 *
 * The request was built without `chunking_strategy`, so the OpenAI SDK
 * never even reached the diarized-response parser. After the fix, the
 * shared `buildTranscriptionParams` helper injects
 * `chunking_strategy: "auto"` whenever `response_format === "diarized_json"`,
 * and both call sites (the sync worker and the manual transcribe route)
 * go through that helper.
 *
 * This file pins both halves:
 *   1. Unit: helper produces the right params.
 *   2. Integration: `transcribeRecording` actually sends the param to
 *      `openai.audio.transcriptions.create` for a diarize model, and does
 *      not send it for non-diarize models.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
    buildTranscriptionParams,
    getResponseFormat,
} from "@/lib/transcription/format";

describe("issue #101 — buildTranscriptionParams sends chunking_strategy for diarize", () => {
    const fakeFile = new File([new Uint8Array([1, 2, 3])], "x.mp3", {
        type: "audio/mpeg",
    });

    it("adds chunking_strategy: 'auto' when response_format is diarized_json", () => {
        const params = buildTranscriptionParams({
            file: fakeFile,
            model: "gpt-4o-transcribe-diarize",
            responseFormat: getResponseFormat("gpt-4o-transcribe-diarize"),
        });
        expect(params.response_format).toBe("diarized_json");
        expect(
            (params as { chunking_strategy?: unknown }).chunking_strategy,
        ).toBe("auto");
    });

    it("omits chunking_strategy for whisper-1 (verbose_json)", () => {
        const params = buildTranscriptionParams({
            file: fakeFile,
            model: "whisper-1",
            responseFormat: getResponseFormat("whisper-1"),
        });
        expect(params.response_format).toBe("verbose_json");
        expect(
            (params as { chunking_strategy?: unknown }).chunking_strategy,
        ).toBeUndefined();
    });

    it("omits chunking_strategy for plain gpt-4o-transcribe (json)", () => {
        const params = buildTranscriptionParams({
            file: fakeFile,
            model: "gpt-4o-transcribe",
            responseFormat: getResponseFormat("gpt-4o-transcribe"),
        });
        expect(params.response_format).toBe("json");
        expect(
            (params as { chunking_strategy?: unknown }).chunking_strategy,
        ).toBeUndefined();
    });

    it("forwards an explicit language hint when provided", () => {
        const params = buildTranscriptionParams({
            file: fakeFile,
            model: "whisper-1",
            responseFormat: "verbose_json",
            language: "en",
        });
        expect((params as { language?: string }).language).toBe("en");
    });

    it("omits language when not provided (no empty string leaking through)", () => {
        const params = buildTranscriptionParams({
            file: fakeFile,
            model: "whisper-1",
            responseFormat: "verbose_json",
        });
        expect((params as { language?: string }).language).toBeUndefined();
    });
});

// Integration: end-to-end through `transcribeRecording`. Verifies both the
// sync-worker path and the manual-route override path arrive at
// `openai.audio.transcriptions.create` with chunking_strategy when a
// diarize model is in play.

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

// `verbose_json` providers (whisper-1, Systran/faster-whisper-*) now go
// through `streamTranscribe` (SSE) for real per-segment progress. The
// diarize / json paths stay on the SDK — they need format-specific
// response parsing and don't benefit from streaming the same way.
// Stub the helper here so the existing whisper-1 tests below remain
// concerned with "did we hit the right transcription endpoint" rather
// than the SSE byte stream itself, which is tested elsewhere.
vi.mock("@/lib/transcription/stream-transcribe", () => ({
    streamTranscribe: vi.fn().mockResolvedValue({
        text: "plain whisper transcript",
        detectedLanguage: "en",
        finalProgressSeconds: 0,
    }),
}));

import { OpenAI } from "openai";
import { db } from "@/db";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

describe("issue #101 — transcribeRecording sends chunking_strategy for diarize models", () => {
    const userId = "user-101";
    const recordingId = "rec-101";

    function mockRecordingFlow(opts: {
        defaultModel: string;
        /**
         * Stub an existing transcription row. Used to exercise the
         * idempotent short-circuit vs. the `force: true` re-run path.
         */
        existingTranscription?: { id: string; text: string };
    }) {
        const recordingRow = {
            id: recordingId,
            userId,
            plaudFileId: "plaud-1",
            filename: "Some Recording",
            storagePath: "rec-101.mp3",
            deletedAt: null,
        };
        const credsRow = {
            id: "creds-1",
            provider: "OpenAI",
            apiKey: "encrypted-key",
            baseUrl: null,
            defaultModel: opts.defaultModel,
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
                        limit: vi
                            .fn()
                            .mockResolvedValue(
                                opts.existingTranscription
                                    ? [opts.existingTranscription]
                                    : [],
                            ),
                    }),
                }),
            })
            // credentials (default OR by id — same shape returned)
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
        (db.transaction as Mock).mockImplementation(
            async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
        );
    }

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
        // Satisfy the in-flight-claim + release `db.update(...)` calls in
        // `transcribeRecording`. `.where(...)` is thenable AND exposes
        // `.returning()` so the claim (which awaits `.returning()`) and
        // the release (which awaits `.where()` directly) share one mock.
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: recordingId }]),
                    // biome-ignore lint/suspicious/noThenProperty: thenable mock — drizzle chain is awaited in some call sites, returning() is used in others, single mock covers both
                    then: (
                        onFulfilled?: (value: undefined) => unknown,
                        onRejected?: (reason: unknown) => unknown,
                    ) =>
                        Promise.resolve(undefined).then(
                            onFulfilled,
                            onRejected,
                        ),
                }),
            }),
        });
    });

    it("sends chunking_strategy: 'auto' when defaultModel is gpt-4o-transcribe-diarize", async () => {
        audioCreate.mockResolvedValue({
            segments: [
                { speaker: "speaker_1", text: "hello" },
                { speaker: "speaker_2", text: "world" },
            ],
        });
        mockRecordingFlow({ defaultModel: "gpt-4o-transcribe-diarize" });

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(1);
        const args = audioCreate.mock.calls[0]?.[0];
        expect(args.model).toBe("gpt-4o-transcribe-diarize");
        expect(args.response_format).toBe("diarized_json");
        expect(args.chunking_strategy).toBe("auto");
    });

    it("does NOT send chunking_strategy for non-diarize models", async () => {
        // verbose_json providers now go through the SSE streamTranscribe
        // path (see vi.mock above) — `audioCreate` is bypassed entirely
        // for whisper-1. The original intent of this assertion was
        // "chunking_strategy must not leak onto non-diarize calls"; we
        // restate it as "the SDK transcribe endpoint was never even
        // contacted for the whisper-1 path", which is the stronger
        // guarantee (no params can sneak in at all).
        mockRecordingFlow({ defaultModel: "whisper-1" });

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        expect(audioCreate).not.toHaveBeenCalled();
    });

    it("respects manual model override and sends chunking_strategy when the override is diarize", async () => {
        audioCreate.mockResolvedValue({
            segments: [{ speaker: "speaker_1", text: "override path" }],
        });
        // Provider default is plain whisper-1; the manual route overrides
        // it to the diarize model. The shared helper must still inject
        // chunking_strategy. `force: true` mirrors the real route so the
        // existing-transcription short-circuit can't hide the override.
        mockRecordingFlow({ defaultModel: "whisper-1" });

        const result = await transcribeRecording(userId, recordingId, {
            model: "gpt-4o-transcribe-diarize",
            force: true,
        });

        expect(result.success).toBe(true);
        const args = audioCreate.mock.calls[0]?.[0];
        expect(args.model).toBe("gpt-4o-transcribe-diarize");
        expect(args.chunking_strategy).toBe("auto");
    });

    it("force: true re-runs the provider even when a transcript already exists", async () => {
        // Without `force`, the worker would short-circuit on the existing
        // transcription row and the manual override would never reach the
        // provider. The manual route passes `force: true` for exactly
        // this reason.
        audioCreate.mockResolvedValue({
            segments: [{ speaker: "speaker_1", text: "fresh diarized run" }],
        });
        mockRecordingFlow({
            defaultModel: "whisper-1",
            existingTranscription: { id: "tr-1", text: "enc:stale" },
        });

        const result = await transcribeRecording(userId, recordingId, {
            model: "gpt-4o-transcribe-diarize",
            force: true,
        });

        expect(result.success).toBe(true);
        expect(audioCreate).toHaveBeenCalledTimes(1);
        const args = audioCreate.mock.calls[0]?.[0];
        expect(args.model).toBe("gpt-4o-transcribe-diarize");
        expect(args.chunking_strategy).toBe("auto");
    });

    it("without force, short-circuits on an existing transcript and skips the provider call", async () => {
        mockRecordingFlow({
            defaultModel: "gpt-4o-transcribe-diarize",
            existingTranscription: {
                id: "tr-1",
                text: "enc:already transcribed",
            },
        });

        const result = await transcribeRecording(userId, recordingId);

        expect(result.success).toBe(true);
        expect(audioCreate).not.toHaveBeenCalled();
    });
});
