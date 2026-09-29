import {
    FinishReason,
    type GenerateContentResponse,
    GoogleGenerativeAIResponseError,
} from "@google/generative-ai";
import { fetchTranscription } from "@/lib/transcription/fetch";

export interface GeminiTranscribeArgs {
    apiKey: string;
    model: string;
    audioBuffer: Buffer;
    contentType: string;
    language?: string;
    timeoutMs: number;
}

export interface GeminiTranscribeResult {
    text: string;
    detectedLanguage: string | null;
}

// Maps Node.js/HTTP content-type strings to Gemini-accepted MIME types.
// Gemini supports a wider set than Whisper; list all known voice formats.
const MIME_TYPE_MAP: Record<string, string> = {
    "audio/mpeg": "audio/mpeg",
    "audio/mp3": "audio/mpeg",
    "audio/mp4": "audio/mp4",
    "audio/wav": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/ogg": "audio/ogg",
    "audio/opus": "audio/opus",
    "audio/flac": "audio/flac",
    "audio/aac": "audio/aac",
    "audio/webm": "audio/webm",
};

const INLINE_DATA_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB

const TRANSCRIBE_INSTRUCTION =
    "Transcribe the attached audio verbatim. Output only the transcript text — no preamble, no summary, no timestamps, no speaker labels, no markdown.";

export class GeminiTranscribeFormatError extends Error {
    constructor(public contentType: string) {
        super(
            `Google Gemini transcription does not support the audio format "${contentType}". ` +
                `Supported formats: mp3, mp4, wav, ogg, opus, flac, aac, webm.`,
        );
        this.name = "GeminiTranscribeFormatError";
    }
}

export class GeminiTranscribeSizeError extends Error {
    constructor(public sizeBytes: number) {
        super(
            `Audio file (${Math.round(sizeBytes / 1024 / 1024)} MB) exceeds the ` +
                `${INLINE_DATA_LIMIT_BYTES / 1024 / 1024} MB inline limit for Google Gemini. ` +
                `Google File API upload support is planned for a future release.`,
        );
        this.name = "GeminiTranscribeSizeError";
    }
}

function responseText(response: GenerateContentResponse): string {
    const candidate = response.candidates?.[0];
    if (!candidate) {
        const feedback = response.promptFeedback;
        if (feedback) {
            const reason = feedback.blockReason
                ? ` due to ${feedback.blockReason}`
                : "";
            const detail = feedback.blockReasonMessage
                ? `: ${feedback.blockReasonMessage}`
                : "";
            throw new GoogleGenerativeAIResponseError(
                `Text not available. Response was blocked${reason}${detail}`,
                response,
            );
        }
        return "";
    }

    if (
        candidate.finishReason === FinishReason.RECITATION ||
        candidate.finishReason === FinishReason.SAFETY ||
        candidate.finishReason === FinishReason.LANGUAGE
    ) {
        const detail = candidate.finishMessage
            ? `: ${candidate.finishMessage}`
            : "";
        throw new GoogleGenerativeAIResponseError(
            `Candidate was blocked due to ${candidate.finishReason}${detail}`,
            response,
        );
    }

    const texts: string[] = [];
    for (const part of candidate.content?.parts ?? []) {
        if (part.text) texts.push(part.text);
        if (part.executableCode) {
            texts.push(
                `\n\`\`\`${part.executableCode.language}\n${part.executableCode.code}\n\`\`\`\n`,
            );
        }
        if (part.codeExecutionResult) {
            texts.push(
                `\n\`\`\`\n${part.codeExecutionResult.output}\n\`\`\`\n`,
            );
        }
    }
    return texts.join("");
}

export async function geminiTranscribe({
    apiKey,
    model,
    audioBuffer,
    contentType,
    language,
    timeoutMs,
}: GeminiTranscribeArgs): Promise<GeminiTranscribeResult> {
    const mimeType = MIME_TYPE_MAP[contentType.toLowerCase()];
    if (!mimeType) {
        throw new GeminiTranscribeFormatError(contentType);
    }

    if (audioBuffer.byteLength > INLINE_DATA_LIMIT_BYTES) {
        throw new GeminiTranscribeSizeError(audioBuffer.byteLength);
    }

    const prompt = language
        ? `${TRANSCRIBE_INSTRUCTION} The audio language is ${language}.`
        : TRANSCRIBE_INSTRUCTION;
    const modelPath = (model.includes("/") ? model : `models/${model}`)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    const response = await fetchTranscription(
        `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType,
                                    data: audioBuffer.toString("base64"),
                                },
                            },
                        ],
                    },
                ],
            }),
        },
        timeoutMs,
    );
    if (!response.ok) {
        throw new Error(
            `Google Gemini transcription failed (${response.status}).`,
        );
    }
    const result = (await response.json()) as GenerateContentResponse;
    const text = responseText(result);
    if (!text || text.trim() === "") {
        throw new Error(
            "Google Gemini returned an empty transcription. The audio may be silent or the model may not have recognised the content.",
        );
    }

    return {
        text: text.trim(),
        detectedLanguage: language ?? null,
    };
}
