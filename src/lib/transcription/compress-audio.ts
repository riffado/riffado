import { spawn } from "node:child_process";
import { env } from "@/lib/env";

const MIN_BITRATE_KBPS = 6;
const WHISPER_HARD_LIMIT_BYTES = 25 * 1024 * 1024;

export interface CompressResult {
    buffer: Buffer;
    contentType: string;
    compressed: boolean;
    /** Final Opus bitrate the encode landed on, in kbit/s. Undefined when not compressed. */
    finalBitrateKbps?: number;
}

export interface CompressOptions {
    maxBytes?: number;
    bitrateKbps?: number;
}

/**
 * Re-encode an audio buffer to mono Opus when it exceeds OpenAI Whisper's
 * 25 MiB per-request limit. Buffers under the threshold pass through unchanged.
 *
 * Runs `ffmpeg` as a child process — the binary must be present in the
 * runtime image. Returns the original buffer with `compressed: false` when
 * no re-encode is needed; otherwise a fresh Ogg/Opus buffer with
 * `contentType: "audio/ogg"`.
 *
 * The starting bitrate (default 12 kbit/s) sizes the common case. For very
 * long recordings the first encode may still exceed the 25 MiB hard cap;
 * in that case the bitrate is halved and the encode retried, down to a
 * 6 kbit/s floor. 6 kbit/s mono Opus fits ~8 h of speech in one request
 * with quality still adequate for Whisper.
 */
export async function maybeCompressForWhisper(
    audioBuffer: Buffer,
    contentType: string,
    opts: CompressOptions = {},
): Promise<CompressResult> {
    const maxBytes = opts.maxBytes ?? env.WHISPER_MAX_BYTES;
    const startBitrate = opts.bitrateKbps ?? env.WHISPER_COMPRESS_BITRATE_KBPS;

    if (audioBuffer.length <= maxBytes) {
        return { buffer: audioBuffer, contentType, compressed: false };
    }

    let bitrate = startBitrate;
    let output = await ffmpegToOpus(audioBuffer, bitrate);

    while (
        output.length > WHISPER_HARD_LIMIT_BYTES &&
        bitrate > MIN_BITRATE_KBPS
    ) {
        const nextBitrate = Math.max(MIN_BITRATE_KBPS, Math.floor(bitrate / 2));
        console.warn(
            `[whisper-compress] ${formatMib(output.length)} at ${bitrate} kbit/s still exceeds 25 MiB; retrying at ${nextBitrate} kbit/s`,
        );
        bitrate = nextBitrate;
        output = await ffmpegToOpus(audioBuffer, bitrate);
    }

    if (output.length > WHISPER_HARD_LIMIT_BYTES) {
        throw new Error(
            `Audio still exceeds Whisper's 25 MiB limit at the minimum bitrate (${MIN_BITRATE_KBPS} kbit/s, output ${formatMib(output.length)}). ` +
                "Recording is too long for single-request transcription; chunking is required.",
        );
    }

    console.info(
        `[whisper-compress] re-encoded ${formatMib(audioBuffer.length)} → ${formatMib(output.length)} at ${bitrate} kbit/s mono Opus`,
    );

    return {
        buffer: output,
        contentType: "audio/ogg",
        compressed: true,
        finalBitrateKbps: bitrate,
    };
}

function formatMib(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function ffmpegToOpus(input: Buffer, bitrateKbps: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ff = spawn(
            "ffmpeg",
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-vn",
                "-map_metadata",
                "-1",
                "-ac",
                "1",
                "-c:a",
                "libopus",
                "-b:a",
                `${bitrateKbps}k`,
                "-application",
                "voip",
                "-f",
                "ogg",
                "pipe:1",
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
        );

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;

        const settleReject = (err: Error) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        ff.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
        ff.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

        ff.on("error", (err) => {
            settleReject(
                new Error(
                    `ffmpeg spawn failed (binary missing from runtime image?): ${err.message}`,
                ),
            );
        });

        ff.on("close", (code) => {
            if (settled) return;
            if (code !== 0) {
                const stderr = Buffer.concat(stderrChunks).toString("utf8");
                settleReject(
                    new Error(
                        `ffmpeg exited with code ${code}: ${stderr.trim() || "(no stderr)"}`,
                    ),
                );
                return;
            }
            settled = true;
            resolve(Buffer.concat(stdoutChunks));
        });

        ff.stdin.on("error", (err) => {
            settleReject(
                new Error(`ffmpeg stdin write failed: ${err.message}`),
            );
        });

        ff.stdin.end(input);
    });
}
