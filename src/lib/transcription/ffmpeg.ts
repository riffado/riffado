import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runFfmpeg(
    input: Buffer,
    args: readonly string[],
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [...args], {
            stdio: ["pipe", "pipe", "pipe"],
        });

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

export function ffmpegToOpus(
    input: Buffer,
    bitrateKbps: number,
): Promise<Buffer> {
    return runFfmpeg(input, [
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
    ]);
}

/** Mono 16 kHz MP3 for chat-style providers that reject Ogg/Opus. */
export function transcodeToMp3(input: Buffer): Promise<Buffer> {
    return runFfmpeg(input, mp3Args());
}

/** Encode and yield mono 16 kHz MP3 segments from one ffmpeg pass. */
export async function* transcodeToMp3Segments(
    input: Buffer,
    segmentSeconds: number,
): AsyncGenerator<{ buffer: Buffer; index: number; count: number }> {
    const workDir = await mkdtemp(join(tmpdir(), "riffado-diarize-"));
    try {
        const outputPattern = join(workDir, "part-%06d.mp3");
        await runFfmpeg(input, [
            ...ffmpegInputArgs(),
            ...mp3EncodingArgs(),
            "-f",
            "segment",
            "-segment_time",
            segmentSeconds.toFixed(3),
            "-reset_timestamps",
            "1",
            outputPattern,
        ]);
        const filenames = (await readdir(workDir))
            .filter((name) => name.endsWith(".mp3"))
            .sort();
        if (filenames.length === 0) {
            throw new Error("ffmpeg produced no MP3 segments");
        }
        for (const [index, name] of filenames.entries()) {
            yield {
                buffer: await readFile(join(workDir, name)),
                index,
                count: filenames.length,
            };
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

function mp3Args(): string[] {
    return [...ffmpegInputArgs(), ...mp3EncodingArgs(), "-f", "mp3", "pipe:1"];
}

function ffmpegInputArgs(): string[] {
    return ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"];
}

function mp3EncodingArgs(): string[] {
    return [
        "-map",
        "0:a:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
    ];
}
