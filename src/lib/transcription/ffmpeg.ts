import { spawn } from "node:child_process";

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
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
        "-f",
        "mp3",
        "pipe:1",
    ]);
}
