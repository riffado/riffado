/**
 * Chunked MiniMax transcription — merging with offset rescaling,
 * retry-then-marker, and fallback triggering when all segments fail.
 * Stubs instead of network, as in the existing provider tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { MiniMaxVerboseTranscription } from "@/lib/transcription/minimax";
import { MiniMaxTranscriptionError } from "@/lib/transcription/minimax";
import {
    type ChunkTranscriptionResult,
    MAX_ATTEMPTS_PER_CHUNK,
    mergeChunkResults,
    transcribeMinimaxChunked,
    UNINTELLIGIBLE_MARKER,
} from "@/lib/transcription/minimax-chunked";

function chunkResponse(
    segments: MiniMaxVerboseTranscription["segments"],
    duration?: number,
    text?: string,
): MiniMaxVerboseTranscription {
    return {
        text: text ?? (segments ?? []).map((s) => s?.text).join(" "),
        duration,
        segments,
    };
}

describe("mergeChunkResults", () => {
    it("rescales timestamps globally by the segment offset", () => {
        const parts: ChunkTranscriptionResult[] = [
            {
                response: chunkResponse(
                    [
                        { start: 0, end: 3, speaker: "S1", text: "Hallo" },
                        { start: 3.5, end: 6, speaker: "S2", text: "Welt" },
                    ],
                    480,
                ),
                durationSeconds: 480,
                hardFailed: false,
            },
            {
                response: chunkResponse(
                    [{ start: 0, end: 4, speaker: "S1", text: "Weiter" }],
                    300,
                ),
                durationSeconds: 300,
                hardFailed: false,
            },
        ];

        const merged = mergeChunkResults(parts, {
            failedChunks: 0,
            chunkCount: 2,
            language: "de",
        });

        expect(merged.segments).toHaveLength(3);
        expect(merged.segments[0]).toMatchObject({
            start: 0,
            end: 3,
            speaker: "S1",
            chunkIndex: 0,
        });
        // Chunk 1 starts at 480 s -> its local times shift by 480.
        expect(merged.segments[2]).toMatchObject({
            start: 480,
            end: 484,
            speaker: "S1",
            chunkIndex: 1,
        });
        expect(merged.detectedLanguage).toBe("de");
        expect(merged.failedChunks).toBe(0);
    });

    it("formats running text as '[S1] text', chunks joined with ' '", () => {
        const merged = mergeChunkResults(
            [
                {
                    response: chunkResponse(
                        [
                            { start: 0, end: 2, speaker: "S1", text: "Hallo" },
                            { start: 2, end: 4, speaker: "S2", text: "Welt" },
                        ],
                        480,
                    ),
                    durationSeconds: 480,
                    hardFailed: false,
                },
                {
                    response: chunkResponse(
                        [{ start: 0, end: 2, speaker: "S1", text: "Weiter" }],
                        480,
                    ),
                    durationSeconds: 480,
                    hardFailed: false,
                },
            ],
            { failedChunks: 0, chunkCount: 2 },
        );

        expect(merged.text).toBe("[S1] Hallo [S2] Welt [S1] Weiter");
    });

    it("marks failed chunks as [UNINTELLIGIBLE] and counts them", () => {
        const merged = mergeChunkResults(
            [
                { response: null, durationSeconds: 480, hardFailed: true },
                {
                    response: chunkResponse(
                        [{ start: 0, end: 2, speaker: "S1", text: "Welt" }],
                        480,
                    ),
                    durationSeconds: 480,
                    hardFailed: false,
                },
            ],
            { failedChunks: 1, chunkCount: 2 },
        );

        expect(merged.text).toBe(`${UNINTELLIGIBLE_MARKER} [S1] Welt`);
        expect(merged.failedChunks).toBe(1);
        expect(merged.segments).toHaveLength(1);
        // The second chunk's offset still counts from 480 s.
        expect(merged.segments[0].start).toBe(480);
    });
});

describe("transcribeMinimaxChunked", () => {
    it("transcribes all chunks sequentially", async () => {
        const transcribeChunk = vi.fn(
            async (index: number): Promise<MiniMaxVerboseTranscription> =>
                chunkResponse(
                    [
                        {
                            start: 0,
                            end: 2,
                            speaker: "S1",
                            text: `Chunk ${index}`,
                        },
                    ],
                    480,
                ),
        );

        const merged = await transcribeMinimaxChunked({
            chunkCount: 3,
            chunkDurationSeconds: 480,
            transcribeChunk,
        });

        expect(transcribeChunk).toHaveBeenCalledTimes(3);
        expect(merged.chunkCount).toBe(3);
        expect(merged.text).toBe("[S1] Chunk 0 [S1] Chunk 1 [S1] Chunk 2");
        expect(merged.segments[2].start).toBe(960);
    });

    it("retry-then-marker: a single failure is retried, then marked", async () => {
        // Chunk 0: first attempt throws, retry delivers. Chunk 1: both
        // attempts throw -> marker.
        const transcribeChunk = vi.fn(async (index: number) => {
            const call = transcribeChunk.mock.calls.length;
            if (index === 0 && call === 1) {
                throw new MiniMaxTranscriptionError("429", {
                    status: 429,
                });
            }
            if (index === 1) {
                throw new MiniMaxTranscriptionError("500", {
                    status: 500,
                });
            }
            return chunkResponse(
                [{ start: 0, end: 2, speaker: "S1", text: "OK" }],
                480,
            );
        });

        const merged = await transcribeMinimaxChunked({
            chunkCount: 2,
            chunkDurationSeconds: 480,
            transcribeChunk,
        });

        // Chunk 0: 2 attempts, chunk 1: 2 attempts.
        expect(transcribeChunk).toHaveBeenCalledTimes(4);
        expect(merged.text).toBe(`[S1] OK ${UNINTELLIGIBLE_MARKER}`);
        expect(merged.failedChunks).toBe(1);
    });

    it("empty responses count as failures and get the same retry", async () => {
        const transcribeChunk = vi.fn(async () =>
            chunkResponse([], 480, "   "),
        );

        const merged = await transcribeMinimaxChunked({
            chunkCount: 1,
            chunkDurationSeconds: 480,
            transcribeChunk,
        });

        expect(transcribeChunk).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_CHUNK);
        expect(merged.failedChunks).toBe(1);
        expect(merged.text).toBe(UNINTELLIGIBLE_MARKER);
    });

    it("throws MiniMaxTranscriptionError when ALL chunks fail (fallback trigger)", async () => {
        const transcribeChunk = vi.fn(async () => {
            throw new MiniMaxTranscriptionError("all down", {
                status: 500,
                retryable: true,
            });
        });

        await expect(
            transcribeMinimaxChunked({
                chunkCount: 2,
                chunkDurationSeconds: 480,
                transcribeChunk,
            }),
        ).rejects.toBeInstanceOf(MiniMaxTranscriptionError);

        // Initial attempt + retry per chunk.
        expect(transcribeChunk).toHaveBeenCalledTimes(4);
    });

    it("fallback chain: an all-chunks failure can be caught by a whisper fallback", async () => {
        const whisperFallback = vi.fn(async () => ({
            text: "whisper text",
            detectedLanguage: "de",
        }));
        const transcribeChunk = vi.fn(async () => {
            throw new MiniMaxTranscriptionError("429", { status: 429 });
        });

        let text = "";
        try {
            await transcribeMinimaxChunked({
                chunkCount: 2,
                chunkDurationSeconds: 480,
                transcribeChunk,
            });
        } catch (error) {
            if (!(error instanceof MiniMaxTranscriptionError)) throw error;
            // Exactly what transcribe-recording.ts does: same segments
            // through the whisper-style path.
            text = (await whisperFallback()).text;
        }

        expect(text).toBe("whisper text");
        expect(whisperFallback).toHaveBeenCalledTimes(1);
    });

    it("prefers the provider-reported duration for the offset", async () => {
        const transcribeChunk = vi.fn(
            async (index: number): Promise<MiniMaxVerboseTranscription> =>
                chunkResponse(
                    [{ start: 0, end: 2, speaker: "S1", text: `C${index}` }],
                    // Provider reports the real (differing) chunk duration.
                    index === 0 ? 470.5 : 481.25,
                ),
        );

        const merged = await transcribeMinimaxChunked({
            chunkCount: 2,
            chunkDurationSeconds: 480,
            transcribeChunk,
        });

        expect(merged.segments[1].start).toBe(470.5);
    });
});
