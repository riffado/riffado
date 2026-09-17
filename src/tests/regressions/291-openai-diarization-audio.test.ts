/**
 * Regression: issue #291
 *
 * Plaud Ogg/Opus recordings can be rejected by OpenAI's diarization model even
 * when the container is valid, and the provider rejects any generated chunk
 * longer than 1,400 seconds. Riffado now normalizes diarization input to MP3
 * and splits long recordings into balanced chunks of at most 20 minutes.
 */
import type { OpenAI } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { transcodeToMp3, transcodeToMp3Segments } = vi.hoisted(() => ({
    transcodeToMp3: vi.fn(),
    transcodeToMp3Segments: vi.fn(),
}));

vi.mock("@/lib/transcription/ffmpeg", () => ({
    transcodeToMp3,
    transcodeToMp3Segments,
}));

import { transcribeOpenAIDiarized } from "@/lib/transcription/openai-diarized-transcribe";

describe("issue #291 — OpenAI diarization audio preparation", () => {
    const audioBuffer = Buffer.from("plaud-ogg-opus");
    const create = vi.fn();
    const client = {
        audio: { transcriptions: { create } },
    } as unknown as OpenAI;

    beforeEach(() => {
        vi.clearAllMocks();
        transcodeToMp3.mockResolvedValue(Buffer.from("normalized-mp3"));
        mockSegments([Buffer.from("chunk-1"), Buffer.from("chunk-2")]);
    });

    it("normalizes a short recording to MP3 before transcription", async () => {
        create.mockResolvedValue({
            duration: 60,
            segments: [
                { speaker: "A", start: 2.4, text: "Hello" },
                { speaker: "A", start: 4.8, text: "again" },
                { speaker: "B", start: 8.1, text: "Hi there" },
            ],
        });

        const result = await transcribeOpenAIDiarized({
            client,
            model: "gpt-4o-transcribe-diarize",
            audioBuffer,
            durationMs: 60_000,
            filename: "meeting.ogg",
            timeoutMs: 10_000,
        });

        expect(transcodeToMp3).toHaveBeenCalledWith(audioBuffer);
        expect(transcodeToMp3Segments).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
        const params = create.mock.calls[0]?.[0];
        expect(params.file).toMatchObject({
            name: "meeting.mp3",
            type: "audio/mpeg",
        });
        expect(params.response_format).toBe("diarized_json");
        expect(params.chunking_strategy).toBe("auto");
        expect(result.text).toBe(
            "[00:02] Speaker 1\nHello again\n\n[00:08] Speaker 2\nHi there",
        );
    });

    it("splits a 1,483 second recording into balanced sub-limit chunks", async () => {
        create
            .mockResolvedValueOnce({
                duration: 740,
                segments: [{ speaker: "A", start: 0, text: "First" }],
            })
            .mockResolvedValueOnce({
                duration: 741.96,
                segments: [{ speaker: "A", start: 8.04, text: "Second" }],
            });

        const result = await transcribeOpenAIDiarized({
            client,
            model: "gpt-4o-transcribe-diarize",
            audioBuffer,
            durationMs: 1_483_920,
            filename: "long-meeting.ogg",
            language: "en",
            timeoutMs: 10_000,
        });

        expect(transcodeToMp3Segments).toHaveBeenCalledOnce();
        expect(transcodeToMp3Segments).toHaveBeenCalledWith(
            audioBuffer,
            741.96,
        );
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[0]?.[0].file.name).toBe(
            "long-meeting-part-1.mp3",
        );
        expect(create.mock.calls[1]?.[0].file.name).toBe(
            "long-meeting-part-2.mp3",
        );
        expect(create.mock.calls[0]?.[0].language).toBe("en");
        expect(result.text).toBe(
            "[00:00] Speaker 1 · Part 1\nFirst\n\n[12:30] Speaker 1 · Part 2\nSecond",
        );
    });

    it("keeps every generated chunk at or below 20 minutes", async () => {
        mockSegments([
            Buffer.from("chunk-1"),
            Buffer.from("chunk-2"),
            Buffer.from("chunk-3"),
            Buffer.from("chunk-4"),
        ]);
        create.mockResolvedValue({ duration: 900.75, segments: [] });

        await transcribeOpenAIDiarized({
            client,
            model: "gpt-4o-transcribe-diarize",
            audioBuffer,
            durationMs: 3_603_000,
            filename: "one-hour-recording.ogg",
            timeoutMs: 10_000,
        });

        expect(transcodeToMp3Segments).toHaveBeenCalledOnce();
        expect(transcodeToMp3Segments.mock.calls[0]?.[1]).toBeLessThan(20 * 60);
        expect(create).toHaveBeenCalledTimes(4);
    });

    function mockSegments(buffers: Buffer[]) {
        transcodeToMp3Segments.mockReturnValue(
            (async function* () {
                for (const [index, buffer] of buffers.entries()) {
                    yield { buffer, index, count: buffers.length };
                }
            })(),
        );
    }
});
