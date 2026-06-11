import type { OpenAI } from "openai";

export interface ChatTranscribeArgs {
    client: OpenAI;
    model: string;
    audioBuffer: Buffer;
    contentType: string;
    language?: string;
}

export interface ChatTranscribeResult {
    text: string;
    detectedLanguage: string | null;
}

function contentTypeToAudioFormat(contentType: string): "mp3" | "wav" {
    const ct = contentType.toLowerCase();
    if (ct === "audio/mpeg" || ct === "audio/mp3") return "mp3";
    if (ct === "audio/wav" || ct === "audio/x-wav" || ct === "audio/wave") {
        return "wav";
    }
    throw new ChatTranscribeFormatError(contentType);
}

export class ChatTranscribeFormatError extends Error {
    constructor(public contentType: string) {
        super(
            `This transcription provider only accepts mp3 or wav audio (got ${contentType}). ` +
                `Re-upload as mp3/wav, or set a Whisper-compatible provider (OpenAI, Groq, Together AI, ` +
                `or a local Whisper server) as your default for transcription.`,
        );
        this.name = "ChatTranscribeFormatError";
    }
}

const TRANSCRIBE_INSTRUCTION =
    "Transcribe the attached audio verbatim. Output only the transcript text — no preamble, no summary, no timestamps, no speaker labels, no markdown.";

export async function chatTranscribe({
    client,
    model,
    audioBuffer,
    contentType,
    language,
}: ChatTranscribeArgs): Promise<ChatTranscribeResult> {
    const format = contentTypeToAudioFormat(contentType);
    const data = audioBuffer.toString("base64");

    const prompt = language
        ? `${TRANSCRIBE_INSTRUCTION} The audio language is ${language}.`
        : TRANSCRIBE_INSTRUCTION;

    const response = await client.chat.completions.create({
        model,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "input_audio",
                        input_audio: { data, format },
                    } as unknown as {
                        type: "text";
                        text: string;
                    },
                ],
            },
        ],
    });

    const text = response.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.trim() === "") {
        throw new Error(
            "Transcription provider returned an empty response. The model may not support audio input — pick an audio-capable model.",
        );
    }

    return {
        text: text.trim(),
        detectedLanguage: language ?? null,
    };
}
