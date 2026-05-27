import { spawn } from "node:child_process";

const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 16;

export interface CompressResult {
    buffer: Buffer;
    contentType: string;
    compressed: boolean;
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
 * At 16 kbit/s mono Opus, one 25 MiB request fits ~3.5 h of speech, which
 * covers the long-meeting use case the upstream code does not handle.
 */
export async function maybeCompressForWhisper(
    audioBuffer: Buffer,
    contentType: string,
    opts: CompressOptions = {},
): Promise<CompressResult> {
    const maxBytes = opts.maxBytes ?? envMaxBytes() ?? DEFAULT_MAX_BYTES;
    const bitrateKbps =
        opts.bitrateKbps ?? envBitrateKbps() ?? DEFAULT_BITRATE_KBPS;

    if (audioBuffer.length <= maxBytes) {
        return { buffer: audioBuffer, contentType, compressed: false };
    }

    const compressed = await ffmpegToOpus(audioBuffer, bitrateKbps);
    return { buffer: compressed, contentType: "audio/ogg", compressed: true };
}

function envMaxBytes(): number | undefined {
    return parsePositiveInt(process.env.WHISPER_MAX_BYTES);
}

function envBitrateKbps(): number | undefined {
    return parsePositiveInt(process.env.WHISPER_COMPRESS_BITRATE_KBPS);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
