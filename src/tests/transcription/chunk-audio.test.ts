/**
 * chunkAudioForProvider is real chunking with safety margins below
 * MiniMax's hard limits (480 s / 45 MB).
 *
 * - computeChunkPlan covers the limits purely unit-testable.
 * - The fast pass-through (short audio, duration known) stays
 *   byte-identical — the common case costs no ffmpeg call.
 * - The ffmpeg integration cases are guarded and skipped when the
 *   binary is missing (pattern from regression/160-plaud-ogg-opus).
 */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
    CHUNK_MAX_SECONDS,
    chunkAudioForProvider,
    computeChunkPlan,
} from "@/lib/transcription/chunk-audio";

describe("computeChunkPlan (chunking limits 480s/45MB)", () => {
    it("small audio needs no split", () => {
        expect(
            computeChunkPlan({
                byteLength: 5 * 1024 * 1024,
                durationSeconds: 300,
            }),
        ).toEqual({ segmentSeconds: CHUNK_MAX_SECONDS, needsSplit: false });
    });

    it("caps at 480 s when the duration exceeds it", () => {
        const plan = computeChunkPlan({
            byteLength: 10 * 1024 * 1024,
            durationSeconds: 600,
        });
        expect(plan.needsSplit).toBe(true);
        expect(plan.segmentSeconds).toBe(480);
    });

    it("shortens the segment length so a segment stays under 45 MB", () => {
        // 90 MB at 600 s -> 150 kB/s -> 45 MB / 150 kB/s = 300 s.
        const plan = computeChunkPlan({
            byteLength: 90 * 1024 * 1024,
            durationSeconds: 600,
        });
        expect(plan.needsSplit).toBe(true);
        expect(plan.segmentSeconds).toBe(300);
    });

    it("respects the hard 45 MB limit even for short durations", () => {
        const plan = computeChunkPlan({
            byteLength: 90 * 1024 * 1024,
            durationSeconds: 300,
        });
        expect(plan.needsSplit).toBe(true);
        expect(plan.segmentSeconds).toBeLessThanOrEqual(240);
    });

    it("unknown duration + small audio: pass-through without ffmpeg", () => {
        // Dev machines without ffmpeg and legacy rows without a duration
        // keep the single-request behavior (see #58: no ffprobe).
        expect(
            computeChunkPlan({ byteLength: 1024, durationSeconds: null }),
        ).toEqual({ segmentSeconds: CHUNK_MAX_SECONDS, needsSplit: false });
        expect(computeChunkPlan({ byteLength: 1024 })).toEqual({
            segmentSeconds: CHUNK_MAX_SECONDS,
            needsSplit: false,
        });
    });

    it("unknown duration + audio over 45 MB: split with size control", () => {
        const plan = computeChunkPlan({
            byteLength: 60 * 1024 * 1024,
            durationSeconds: null,
        });
        expect(plan.needsSplit).toBe(true);
        expect(plan.segmentSeconds).toBe(CHUNK_MAX_SECONDS);
    });
});

describe("chunkAudioForProvider (pass-through)", () => {
    it("short audio comes back as a single unchanged chunk", async () => {
        const audioBuffer = Buffer.alloc(1024, 0xab);
        const chunks = await chunkAudioForProvider({
            audioBuffer,
            contentType: "audio/mpeg",
            provider: "Groq",
            model: "whisper-large-v3-turbo",
            durationMs: 60_000,
        });

        expect(chunks).toHaveLength(1);
        expect(chunks[0].index).toBe(0);
        expect(chunks[0].contentType).toBe("audio/mpeg");
        expect(chunks[0].buffer).toBe(audioBuffer);
    });
});

const hasFfmpeg =
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const itFfmpeg = hasFfmpeg ? it : it.skip;

describe("chunkAudioForProvider (ffmpeg integration)", () => {
    itFfmpeg(
        "splits a signal into ascendingly indexed segments",
        async () => {
            // 2.5 s sine wave as Ogg/Opus; the limits test seam switches to
            // 1 s segments -> 3 chunks expected.
            const sine = spawnSync(
                "ffmpeg",
                [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=2.5",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "24k",
                    "-f",
                    "ogg",
                    "pipe:1",
                ],
                { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
            );
            if (sine.status !== 0) {
                throw new Error("ffmpeg could not generate the test signal");
            }

            const chunks = await chunkAudioForProvider({
                audioBuffer: sine.stdout as Buffer,
                contentType: "audio/ogg",
                provider: "MiniMax",
                model: "asr-1.0",
                durationMs: 2_500,
                limits: { maxSeconds: 1 },
            });

            expect(chunks.length).toBeGreaterThanOrEqual(2);
            expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
            for (const chunk of chunks) {
                expect(chunk.contentType).toBe("audio/ogg");
                expect(chunk.buffer.length).toBeGreaterThan(0);
            }
            // No chunk contains the full signal.
            expect(
                chunks.every(
                    (c) => c.buffer.length < (sine.stdout as Buffer).length,
                ),
            ).toBe(true);
        },
        30_000,
    );

    itFfmpeg(
        "ogg segments stay decodable (container integrity)",
        async () => {
            const sine = spawnSync(
                "ffmpeg",
                [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=220:duration=2.0",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "24k",
                    "-f",
                    "ogg",
                    "pipe:1",
                ],
                { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
            );
            if (sine.status !== 0) {
                throw new Error("ffmpeg could not generate the test signal");
            }

            const chunks = await chunkAudioForProvider({
                audioBuffer: sine.stdout as Buffer,
                contentType: "audio/ogg",
                provider: "MiniMax",
                model: "asr-1.0",
                durationMs: 2_000,
                limits: { maxSeconds: 1 },
            });

            for (const chunk of chunks) {
                const probe = spawnSync(
                    "ffmpeg",
                    [
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        "pipe:0",
                        "-f",
                        "null",
                        "-",
                    ],
                    { input: chunk.buffer, stdio: ["pipe", "ignore", "pipe"] },
                );
                expect(probe.status, `chunk ${chunk.index} not decodable`).toBe(
                    0,
                );
            }
        },
        30_000,
    );
});
