import { GoogleGenerativeAI } from "@google/generative-ai";

export interface GeminiTranscribeArgs {
    apiKey: string;
    model: string;
    audioBuffer: Buffer;
    contentType: string;
    language?: string;
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

export async function geminiTranscribe({
    apiKey,
    model,
    audioBuffer,
    contentType,
    language,
}: GeminiTranscribeArgs): Promise<GeminiTranscribeResult> {
    const mimeType = MIME_TYPE_MAP[contentType.toLowerCase()];
    if (!mimeType) {
        throw new GeminiTranscribeFormatError(contentType);
    }

    if (audioBuffer.byteLength > INLINE_DATA_LIMIT_BYTES) {
        throw new GeminiTranscribeSizeError(audioBuffer.byteLength);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });

    const prompt = language
        ? `${TRANSCRIBE_INSTRUCTION} The audio language is ${language}.`
        : TRANSCRIBE_INSTRUCTION;

    const response = await geminiModel.generateContent({
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
    });

    const text = response.response.text();
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
