/**
 * Chunked MiniMax transcription with merging.
 *
 * Flow per recording:
 * 1. chunk-audio.ts produces AudioChunk[] (<=480 s / <=45 MB per segment).
 * 2. Each segment runs sequentially through transcribeMinimax —
 *    sequential requests save MiniMax quota and keep segment order.
 * 3. A failed segment (error or empty response) gets exactly 1 retry;
 *    if that also fails, the segment is marked [UNINTELLIGIBLE] instead
 *    of discarding the whole transcription.
 * 4. If ALL segments fail permanently, MiniMaxTranscriptionError is
 *    thrown — transcribe-recording catches it and falls back to the
 *    generic whisper-style path (fallback chain).
 *
 * Merging: speaker labels stay raw per chunk (S1/S2 per chunk — chunk
 * association via `chunkIndex` so a UI can later build a global speaker
 * mapping), timestamps are rescaled by the segment offset.
 */

import {
    MiniMaxTranscriptionError,
    type MiniMaxVerboseTranscription,
} from "@/lib/transcription/minimax";

/** Persistable speaker segment with globally rescaled times. */
export interface MergedTranscriptionSegment {
    /** Seconds, relative to the whole recording. */
    start: number;
    /** Seconds, relative to the whole recording. */
    end: number;
    /** Raw label from MiniMax (S1/S2/...), unique only within chunkIndex. */
    speaker: string;
    text: string;
    /** 0-based chunk index; speaker IDs are only unique within a chunk. */
    chunkIndex: number;
}

export interface MergedChunkedTranscription {
    /** Running text: segments as "[S1] text", chunks joined with ' '. */
    text: string;
    /** Structured segments for a UI (speaker mapping). */
    segments: MergedTranscriptionSegment[];
    detectedLanguage: string | null;
    /** Number of chunks marked [UNINTELLIGIBLE]. */
    failedChunks: number;
    chunkCount: number;
}

/** Marker for a permanently failed segment. */
export const UNINTELLIGIBLE_MARKER = "[UNINTELLIGIBLE]";

/** How many attempts a failing/empty segment gets. */
export const MAX_ATTEMPTS_PER_CHUNK = 2; // initial attempt + 1 retry

export interface ChunkTranscriptionResult {
    response: MiniMaxVerboseTranscription | null;
    /** Seconds this chunk occupies in the recording (offset basis). */
    durationSeconds: number;
    /**
     * true if the chunk hard-failed after all retries (4xx/5xx/timeout).
     * Empty but successful responses do NOT count as hard failures —
     * those are handled by the [UNINTELLIGIBLE] marker.
     */
    hardFailed: boolean;
}

/**
 * Merges the chunk results. `transcribeChunk` is injected so tests need
 * neither network nor ffmpeg (stubs, as in the existing provider tests).
 *
 * Throws MiniMaxTranscriptionError when every chunk produced a HARD
 * error (4xx/5xx/timeout) — the "MiniMax is down or misconfigured"
 * signal that triggers the caller's fallback chain. Empty successful
 * responses lead to the marker instead.
 */
export async function transcribeMinimaxChunked(args: {
    chunkCount: number;
    chunkDurationSeconds: number;
    transcribeChunk: (
        index: number,
    ) => Promise<MiniMaxVerboseTranscription | null>;
    language?: string | null;
}): Promise<MergedChunkedTranscription> {
    const { chunkCount, chunkDurationSeconds, transcribeChunk, language } =
        args;

    const parts: ChunkTranscriptionResult[] = [];
    for (let index = 0; index < chunkCount; index++) {
        let attempt = await safelyTranscribe(transcribeChunk, index);
        let tries = 1;
        while (!attempt.usable && tries < MAX_ATTEMPTS_PER_CHUNK) {
            tries++;
            attempt = await safelyTranscribe(transcribeChunk, index);
        }
        parts.push({
            response: attempt.usable ? attempt.response : null,
            durationSeconds: attempt.response?.duration || chunkDurationSeconds,
            hardFailed: !attempt.usable && attempt.hardError,
        });
    }

    const hardFailures = parts.filter((p) => p.hardFailed).length;
    if (hardFailures === chunkCount) {
        throw new MiniMaxTranscriptionError(
            `MiniMax transcription failed: all ${chunkCount} chunks failed hard (4xx/5xx/timeout)`,
            { retryable: true },
        );
    }

    return mergeChunkResults(parts, {
        failedChunks: parts.filter((p) => p.response === null).length,
        chunkCount,
        language,
    });
}

async function safelyTranscribe(
    transcribeChunk: (
        index: number,
    ) => Promise<MiniMaxVerboseTranscription | null>,
    index: number,
): Promise<{
    response: MiniMaxVerboseTranscription | null;
    usable: boolean;
    hardError: boolean;
}> {
    try {
        const response = await transcribeChunk(index);
        const usable = isUsable(response);
        return { response, usable, hardError: false };
    } catch {
        // Error kinds (4xx/5xx/timeout) are condensed for the retry and
        // fallback decision; here only the hard failure matters.
        return { response: null, usable: false, hardError: true };
    }
}

function isUsable(
    response: MiniMaxVerboseTranscription | null,
): response is MiniMaxVerboseTranscription {
    return !!response && response.text.trim().length > 0;
}

/**
 * Pure merging — exported separately so the offset rescaling and the
 * '[S1] text' format can be unit-tested directly.
 */
export function mergeChunkResults(
    parts: ChunkTranscriptionResult[],
    meta: {
        failedChunks: number;
        chunkCount: number;
        language?: string | null;
    },
): MergedChunkedTranscription {
    const segments: MergedTranscriptionSegment[] = [];
    const textParts: string[] = [];
    let offsetSeconds = 0;

    for (const [chunkIndex, part] of parts.entries()) {
        if (!part.response) {
            textParts.push(UNINTELLIGIBLE_MARKER);
            offsetSeconds += part.durationSeconds;
            continue;
        }

        const chunkSegments = part.response.segments ?? [];
        if (chunkSegments.length === 0) {
            // verbose_json without a segments array: keep the raw text,
            // but still track it as a marked chunk text piece.
            textParts.push(part.response.text.trim());
        } else {
            for (const segment of chunkSegments) {
                segments.push({
                    start: offsetSeconds + segment.start,
                    end: offsetSeconds + segment.end,
                    speaker: segment.speaker,
                    text: segment.text,
                    chunkIndex,
                });
            }
            textParts.push(
                chunkSegments
                    .map((s) => `[${s.speaker}] ${s.text.trim()}`)
                    .join(" "),
            );
        }
        offsetSeconds += part.durationSeconds;
    }

    return {
        text: textParts.join(" "),
        segments,
        detectedLanguage: meta.language ?? null,
        failedChunks: meta.failedChunks,
        chunkCount: meta.chunkCount,
    };
}
