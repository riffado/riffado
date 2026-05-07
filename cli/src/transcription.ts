import { OpenAI } from "openai";
import type { CliConfig } from "./config";
import {
    loadDictionary,
    buildWhisperPrompt,
    applyCorrections,
} from "./dictionary";

export const DEFAULT_WHISPER_MODEL = "whisper-1";

/**
 * Transcribe an audio buffer using the OpenAI-compatible Whisper API.
 *
 * Automatically loads the dictionary from ~/.config/openplaud-cli/dictionary.txt:
 * - Terms are passed as the Whisper `prompt` parameter to bias recognition
 * - Correction rules (wrong → right) are applied as post-processing
 *
 * Works with any OpenAI-compatible provider:
 * - OpenAI (default): whisper-1
 * - Groq (free): whisper-large-v3 at https://api.groq.com/openai/v1
 * - Together AI, OpenRouter, local Ollama, etc.
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    config: CliConfig,
    options?: {
        language?: string;
        filename?: string;
    },
): Promise<string> {
    if (!config.whisperApiKey) {
        throw new Error(
            "No Whisper API key configured. Run `openplaud auth` to set one up.",
        );
    }

    const client = new OpenAI({
        apiKey: config.whisperApiKey,
        ...(config.whisperBaseUrl && { baseURL: config.whisperBaseUrl }),
    });

    const model = config.whisperModel || DEFAULT_WHISPER_MODEL;
    const filename = options?.filename || "recording.mp3";

    // Load dictionary for Whisper prompt and post-processing.
    // Gracefully fall back to empty if the file can't be read (e.g. permissions).
    let dictionary: ReturnType<typeof loadDictionary>;
    try {
        dictionary = loadDictionary();
    } catch {
        dictionary = { terms: [], corrections: [] };
    }
    const whisperPrompt = buildWhisperPrompt(dictionary);

    // Detect content type from buffer magic bytes
    const contentType = detectAudioType(audioBuffer);

    const file = new File([new Uint8Array(audioBuffer)], filename, {
        type: contentType,
    });

    const response = await client.audio.transcriptions.create({
        file,
        model,
        ...(options?.language && { language: options.language }),
        ...(whisperPrompt && { prompt: whisperPrompt }),
    });

    let text = response.text;

    // Apply correction rules from dictionary
    if (dictionary.corrections.length > 0) {
        text = applyCorrections(text, dictionary.corrections);
    }

    return text;
}

/**
 * Detect audio format from file magic bytes.
 */
function detectAudioType(buffer: Buffer): string {
    // OGG/Opus: starts with "OggS"
    if (
        buffer.length >= 4 &&
        buffer[0] === 0x4f &&
        buffer[1] === 0x67 &&
        buffer[2] === 0x67 &&
        buffer[3] === 0x53
    ) {
        return "audio/ogg";
    }

    // MP3: starts with ID3 tag or MPEG sync word
    if (buffer.length >= 3) {
        if (
            buffer[0] === 0x49 &&
            buffer[1] === 0x44 &&
            buffer[2] === 0x33 // ID3
        ) {
            return "audio/mpeg";
        }
        if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
            // MPEG sync
            return "audio/mpeg";
        }
    }

    // WAV: starts with "RIFF"
    if (
        buffer.length >= 4 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46
    ) {
        return "audio/wav";
    }

    // Default to MP3 (Plaud mostly serves MP3)
    return "audio/mpeg";
}
