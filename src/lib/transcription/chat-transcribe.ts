/**
 * Chat-completions-based transcription path.
 *
 * Used for providers that expose audio-input LLMs via `/v1/chat/completions`
 * instead of a dedicated `/v1/audio/transcriptions` endpoint — OpenRouter
 * being the motivating case (issue #122).
 *
 * Wire format follows OpenAI's chat-audio spec: an `input_audio` content
 * part with `{ data: <base64>, format: "mp3" | "wav" }`. We pass a short
 * system-style instruction telling the model to output the transcript
 * verbatim with no commentary.
 *
 * Limitations (documented in the dialog and in the README):
 *   - Format support is mp3 / wav only. Opus / OGG / m4a uploads are
 *     rejected with an actionable error pointing the user at a Whisper
 *     provider. Plaud-synced recordings are always mp3 (sync hardcodes
 *     the extension) so this only bites direct uploads of non-mp3 files.
 *   - No segment timestamps / verbose-JSON metadata — chat-style models
 *     don't surface those. We return `detectedLanguage: language ?? null`
 *     so an explicit language hint still propagates to the DB.
 */

import type { OpenAI } from "openai";

export interface ChatTranscribeArgs {
    client: OpenAI;
    model: string;
    audioBuffer: Buffer;
    /** MIME content type from the stored audio (e.g. "audio/mpeg"). */
    contentType: string;
    /** ISO language hint forwarded to the model in the prompt. */
    language?: string;
}

export interface ChatTranscribeResult {
    text: string;
    detectedLanguage: string | null;
}

/**
 * Map our internal MIME types to the `format` strings OpenAI chat-audio
 * accepts. Anything not in this map throws — see file header.
 */
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

    // The OpenAI SDK's typed `content` union doesn't include `input_audio`
    // for `chat.completions.create` yet (it only types it on the Responses
    // API). At wire-level the parameter is correct for any OpenAI-compatible
    // provider that supports chat-audio (OpenRouter, OpenAI gpt-audio). We
    // pass through the typed object via a structural cast — no runtime
    // transform — and assert the result shape we actually rely on.
    const response = await client.chat.completions.create({
        model,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        // Cast: see comment above.
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
