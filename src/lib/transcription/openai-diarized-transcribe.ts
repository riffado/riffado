import type { OpenAI } from "openai";
import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";
import {
    transcodeToMp3,
    transcodeToMp3Segments,
} from "@/lib/transcription/ffmpeg";
import { buildTranscriptionParams } from "@/lib/transcription/format";

// OpenAI currently rejects diarization chunks over 1,400 seconds. Leave a
// margin for container timestamps and provider-side chunk boundary changes.
const MAX_CHUNK_SECONDS = 20 * 60 - 1;

interface DiarizedTranscriptionOptions {
    client: OpenAI;
    model: string;
    audioBuffer: Buffer;
    durationMs: number;
    filename: string;
    language?: string;
    timeoutMs: number;
}

/** Normalize and locally chunk audio before calling OpenAI's diarization API. */
export async function transcribeOpenAIDiarized(
    options: DiarizedTranscriptionOptions,
): Promise<{ text: string; detectedLanguage: null }> {
    const {
        client,
        model,
        audioBuffer,
        durationMs,
        filename,
        language,
        timeoutMs,
    } = options;
    const durationSeconds = durationMs / 1000;
    const chunkCount = Math.max(
        1,
        Math.ceil(durationSeconds / MAX_CHUNK_SECONDS),
    );
    const chunkDuration = durationSeconds / chunkCount;
    const formattedTurns: string[] = [];

    const transcribeChunk = async (
        mp3: Buffer,
        index: number,
        count: number,
    ) => {
        const file = buildMp3File(mp3, filename, index, count);
        const response = await client.audio.transcriptions.create(
            buildTranscriptionParams({
                file,
                model,
                responseFormat: "diarized_json",
                language,
            }),
            { timeout: timeoutMs },
        );
        const diarized = response as TranscriptionDiarized;
        formattedTurns.push(
            ...formatDiarizedResponse(
                diarized,
                index,
                count,
                index * chunkDuration,
            ),
        );
    };

    if (chunkCount === 1) {
        await transcribeChunk(await transcodeToMp3(audioBuffer), 0, 1);
    } else {
        for await (const segment of transcodeToMp3Segments(
            audioBuffer,
            chunkDuration,
        )) {
            await transcribeChunk(segment.buffer, segment.index, segment.count);
        }
    }

    return {
        text: formattedTurns.join("\n\n"),
        detectedLanguage: null,
    };
}

function buildMp3File(
    buffer: Buffer,
    filename: string,
    index: number,
    chunkCount: number,
): File {
    const stem = filename.replace(/\.[^.]+$/, "");
    const suffix = chunkCount > 1 ? `-part-${index + 1}` : "";
    const view = new Uint8Array(
        buffer.buffer as ArrayBuffer,
        buffer.byteOffset,
        buffer.byteLength,
    );
    return new File([view], `${stem}${suffix}.mp3`, { type: "audio/mpeg" });
}

function formatDiarizedResponse(
    response: TranscriptionDiarized,
    partIndex: number,
    partCount: number,
    timeOffsetSeconds: number,
): string[] {
    const formattedTurns: string[] = [];
    const speakerNumbers = new Map<string, number>();
    const turns: Array<{
        speaker: string;
        start: number;
        text: string;
    }> = [];

    for (const segment of response.segments ?? []) {
        const previous = turns.at(-1);
        if (previous?.speaker === segment.speaker) {
            previous.text = `${previous.text} ${segment.text.trim()}`;
        } else {
            turns.push({
                speaker: segment.speaker,
                start: segment.start,
                text: segment.text.trim(),
            });
        }
    }

    for (const turn of turns) {
        let speakerNumber = speakerNumbers.get(turn.speaker);
        if (speakerNumber === undefined) {
            speakerNumber = speakerNumbers.size + 1;
            speakerNumbers.set(turn.speaker, speakerNumber);
        }
        const partLabel = partCount > 1 ? ` · Part ${partIndex + 1}` : "";
        formattedTurns.push(
            `[${formatTimestamp(timeOffsetSeconds + turn.start)}] Speaker ${speakerNumber}${partLabel}\n${turn.text}`,
        );
    }

    return formattedTurns;
}

function formatTimestamp(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;
    const minuteText = String(minutes).padStart(2, "0");
    const secondText = String(remainingSeconds).padStart(2, "0");

    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${minuteText}:${secondText}`
        : `${minuteText}:${secondText}`;
}
