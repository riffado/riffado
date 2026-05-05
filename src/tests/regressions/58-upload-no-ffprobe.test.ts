/**
 * Regression test for issue #58:
 *   "Upload Audio fails with 'File does not contain a valid audio stream'
 *    - ffmpeg not installed in Docker image"
 *
 * Original bug: the upload route shelled out to `ffprobe` to read audio
 * duration. When the binary was missing (Docker image without ffmpeg, or
 * dev environments where ffprobe is not on the Node process PATH), the
 * helper silently swallowed the spawn error, returned 0, and the route
 * rejected every upload with a misleading "invalid audio stream" message.
 *
 * Fix: replace the ffprobe shell-out with `music-metadata`, a pure-JS
 * parser that works on the in-memory upload buffer with no system
 * dependency. This test asserts the new path correctly reads duration
 * from a real MP3 buffer with no binary on PATH involved.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseBuffer } from "music-metadata";
import { describe, expect, it } from "vitest";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.mp3");

describe("issue #58 — upload duration parsing without ffprobe", () => {
    it("reads MP3 duration from a Buffer via music-metadata (no ffprobe spawn)", async () => {
        const buffer = await readFile(FIXTURE);

        const { format } = await parseBuffer(
            buffer,
            { mimeType: "audio/mpeg", size: buffer.byteLength },
            { duration: true },
        );

        // Fixture is a 1-second 440 Hz sine; allow generous tolerance for
        // MP3 frame alignment on either end. Duration is the only thing
        // this regression cares about — container/codec assertions would
        // just be brittle coupling to music-metadata internals.
        expect(format.duration).toBeGreaterThan(0.5);
        expect(format.duration).toBeLessThan(2);
    });

    it("returns no duration for a non-audio buffer (caller turns this into 422)", async () => {
        const garbage = Buffer.from("this is definitely not an audio file");

        // music-metadata may either throw or return undefined duration for
        // unrecognized input. The route helper treats both as "duration 0
        // → reject with 422", so this test accepts either outcome.
        let duration: number | undefined;
        try {
            const { format } = await parseBuffer(
                garbage,
                { mimeType: "audio/mpeg", size: garbage.byteLength },
                { duration: true },
            );
            duration = format.duration;
        } catch {
            duration = undefined;
        }

        expect(duration ?? 0).toBe(0);
    });
});
