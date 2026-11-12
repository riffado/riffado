/**
 * Provider-aware audio chunking for transcription.
 *
 * - Segments of <=480 s and <=45 MB — safety margins below MiniMax's
 *   hard limits of 500 s / 50 MB per request. The same segments also
 *   apply to whisper-style providers (Groq etc.) whose rows do not set
 *   the full-audio flag.
 * - Small recordings (<=480 s AND <=45 MB, duration known) pass through
 *   as a single chunk without invoking ffmpeg — the common case stays
 *   exactly as cheap as a single request.
 * - The split runs through ffmpeg in the app container (the binary is
 *   available, see whisper-compress/ffmpeg.ts). ffprobe is deliberately
 *   NOT used — runtime images strip it (Issue #58); duration comes from
 *   recording.duration and the size check happens after the split.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "@/lib/transcription/ffmpeg";

/** Safety margin below MiniMax's 500 s limit. */
export const CHUNK_MAX_SECONDS = 480;
/** Safety margin below MiniMax's 50 MB limit. */
export const CHUNK_MAX_BYTES = 45 * 1024 * 1024;

/** Below this segment length, stop halving. */
const MIN_SEGMENT_SECONDS = 30;

export interface ChunkLimits {
    maxSeconds: number;
    maxBytes: number;
}

export interface ChunkAudioForProviderArgs {
    /** Raw audio bytes as stored for the transcription request. */
    audioBuffer: Buffer;
    /** MIME/content type of the audio (e.g. "audio/wav"). */
    contentType: string;
    /** Credential provider name (e.g. "OpenAI", "MiniMax", "Custom"). */
    provider: string;
    /** Model that will receive the chunks (limits may be model-specific). */
    model: string;
    /**
     * Recording duration in milliseconds (recording.duration). Provides
     * the fast pass-through for short recordings and the basis for pure
     * size-based planning. Unknown duration leads to an ffmpeg split
     * followed by a size check.
     */
    durationMs?: number | null;
    /**
     * Limit override (test seam): allows small limits so the ffmpeg
     * split path can be tested without multi-minute test signals.
     */
    limits?: Partial<ChunkLimits>;
}

export interface AudioChunk {
    buffer: Buffer;
    contentType: string;
    /** 0-based position within the recording, for ordered stitch-back. */
    index: number;
}

export interface ChunkPlan {
    /** Segment length in seconds for the ffmpeg segment muxer. */
    segmentSeconds: number;
    /** Whether an ffmpeg split is required (false -> pass-through). */
    needsSplit: boolean;
}

/**
 * Pure planning of the segment length — no ffmpeg, directly unit-testable.
 *
 * - durationSeconds > maxSeconds -> cap at maxSeconds.
 * - bytesPerSecond * segmentSeconds > maxBytes -> shorten segmentSeconds
 *   so a segment stays below the byte limit by construction.
 * - If everything fits into one segment -> needsSplit=false (pass-through).
 */
export function computeChunkPlan({
    byteLength,
    durationSeconds,
    limits = {},
}: {
    byteLength: number;
    durationSeconds?: number | null;
    limits?: Partial<ChunkLimits>;
}): ChunkPlan {
    const maxSeconds = limits.maxSeconds ?? CHUNK_MAX_SECONDS;
    const maxBytes = limits.maxBytes ?? CHUNK_MAX_BYTES;
    const durationKnown =
        durationSeconds !== undefined &&
        durationSeconds !== null &&
        durationSeconds > 0;
    const overDurationLimit = durationKnown && durationSeconds > maxSeconds;

    // Pass through when the size limit is met and the duration is either
    // unknown or below the limit. Unknown duration + small audio: a
    // compressed Ogg under 45 MB is practically never longer than 500 s
    // (24 kbit/s is roughly 4 h) — the previous single-request behavior
    // still applies here, without requiring ffmpeg on dev machines.
    if (byteLength <= maxBytes && !overDurationLimit) {
        return { segmentSeconds: maxSeconds, needsSplit: false };
    }

    let segmentSeconds = maxSeconds;

    if (durationSeconds && durationSeconds > 0) {
        const bytesPerSecond = byteLength / durationSeconds;
        if (bytesPerSecond > 0) {
            const sizeCapped = Math.floor(maxBytes / bytesPerSecond);
            segmentSeconds = Math.max(
                Math.min(MIN_SEGMENT_SECONDS, maxSeconds),
                Math.min(segmentSeconds, sizeCapped),
            );
        }
    }

    return { segmentSeconds, needsSplit: true };
}

/**
 * Split audio into provider-sized chunks.
 *
 * Small recordings (duration known and within limits) come back as a
 * single unchanged chunk. Everything else is segmented via ffmpeg;
 * segments that still exceed the byte limit (e.g. very high bitrates
 * with estimated duration) cause the segment length to be halved and
 * the split to be retried.
 */
export async function chunkAudioForProvider({
    audioBuffer,
    contentType,
    durationMs,
    limits,
}: ChunkAudioForProviderArgs): Promise<AudioChunk[]> {
    const maxBytes = limits?.maxBytes ?? CHUNK_MAX_BYTES;
    const plan = computeChunkPlan({
        byteLength: audioBuffer.length,
        durationSeconds:
            durationMs !== undefined && durationMs !== null
                ? durationMs / 1000
                : null,
        limits,
    });

    if (!plan.needsSplit) {
        return [{ buffer: audioBuffer, contentType, index: 0 }];
    }

    let segmentSeconds = plan.segmentSeconds;
    // Defense against estimated/failed duration planning: at most 5
    // halvings, after that the (oversized) segments are still returned —
    // the provider then reports a clearly attributable error instead of
    // looping forever.
    const minSegmentSeconds = Math.min(
        MIN_SEGMENT_SECONDS,
        plan.segmentSeconds,
    );
    for (let attempt = 0; attempt < 5; attempt++) {
        const chunks = await splitWithFfmpeg(
            audioBuffer,
            contentType,
            segmentSeconds,
        );
        if (chunks.every((c) => c.buffer.length <= maxBytes)) {
            return chunks;
        }
        segmentSeconds = Math.max(
            minSegmentSeconds,
            Math.floor(segmentSeconds / 2),
        );
    }

    return splitWithFfmpeg(audioBuffer, contentType, segmentSeconds);
}

const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/webm": ".webm",
    "audio/flac": ".flac",
};

async function splitWithFfmpeg(
    audioBuffer: Buffer,
    contentType: string,
    segmentSeconds: number,
): Promise<AudioChunk[]> {
    const extension = CONTENT_TYPE_TO_EXTENSION[contentType];
    if (!extension) {
        throw new Error(
            `chunk-audio: unknown content type "${contentType}" — chunking needs a known container (ogg/wav/mp3/m4a/webm/flac)`,
        );
    }

    const workDir = await mkdtemp(join(tmpdir(), "riffado-chunk-"));
    try {
        const outputPattern = join(workDir, `part-%06d${extension}`);
        await runFfmpeg(audioBuffer, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-vn",
            "-map_metadata",
            "-1",
            "-c",
            "copy",
            "-f",
            "segment",
            "-segment_time",
            segmentSeconds.toFixed(3),
            "-reset_timestamps",
            "1",
            outputPattern,
        ]);

        const filenames = (await readdir(workDir))
            .filter((name) => name.endsWith(extension))
            .sort();
        if (filenames.length === 0) {
            throw new Error("ffmpeg produced no audio segments");
        }

        const chunks: AudioChunk[] = [];
        for (const [index, name] of filenames.entries()) {
            chunks.push({
                buffer: await readFile(join(workDir, name)),
                contentType,
                index,
            });
        }
        return chunks;
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}
