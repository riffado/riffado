/**
 * Test for the Whisper-size compression fallback.
 *
 * OpenAI's /v1/audio/transcriptions endpoint has a hard 25 MiB per-request
 * limit. Files that exceed it must be re-encoded to mono Opus before being
 * sent, otherwise the request fails with:
 *
 *   413 413: Maximum content size limit (26214400) exceeded (X bytes read)
 *
 * `maybeCompressForWhisper` is a pure helper around an ffmpeg child
 * process — small buffers pass through unchanged, oversized buffers come
 * back as Ogg/Opus.
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        WHISPER_MAX_BYTES: 24 * 1024 * 1024,
        WHISPER_COMPRESS_BITRATE_KBPS: 12,
    },
}));

import { maybeCompressForWhisper } from "@/lib/transcription/compress-audio";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.mp3");

function hasFfmpeg(): boolean {
    const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return probe.status === 0;
}

function isOggMagic(buf: Buffer): boolean {
    return (
        buf.length >= 4 &&
        buf[0] === 0x4f &&
        buf[1] === 0x67 &&
        buf[2] === 0x67 &&
        buf[3] === 0x53
    );
}

describe("maybeCompressForWhisper", () => {
    it("passes small buffers through unchanged", async () => {
        const buffer = Buffer.from("dummy-audio-bytes");

        const result = await maybeCompressForWhisper(buffer, "audio/mpeg");

        expect(result.compressed).toBe(false);
        expect(result.buffer).toBe(buffer);
        expect(result.contentType).toBe("audio/mpeg");
    });

    it("respects a custom maxBytes threshold", async () => {
        const buffer = Buffer.alloc(100, 0);

        const result = await maybeCompressForWhisper(buffer, "audio/mpeg", {
            maxBytes: 1024,
        });

        expect(result.compressed).toBe(false);
    });

    const itIfFfmpeg = hasFfmpeg() ? it : it.skip;

    itIfFfmpeg(
        "re-encodes oversized buffers to mono Opus in an Ogg container",
        async () => {
            const fixture = await readFile(FIXTURE);

            // Force compression on a small real audio buffer by setting
            // maxBytes well below the fixture size. This exercises the
            // ffmpeg spawn path without needing a multi-MB fixture.
            const result = await maybeCompressForWhisper(
                fixture,
                "audio/mpeg",
                { maxBytes: 100, bitrateKbps: 16 },
            );

            expect(result.compressed).toBe(true);
            expect(result.contentType).toBe("audio/ogg");
            expect(isOggMagic(result.buffer)).toBe(true);
            expect(result.buffer.length).toBeGreaterThan(0);
        },
        15_000,
    );
});
