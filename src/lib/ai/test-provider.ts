import { OpenAI } from "openai";
import { findPreset, getTranscriptionStyle } from "@/lib/ai/provider-presets";
import { env } from "@/lib/env";
import { elevenLabsTranscribe } from "@/lib/transcription/elevenlabs-transcribe";
import {
    buildTranscriptionParams,
    getResponseFormat,
} from "@/lib/transcription/format";
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";
import {
    isMiniMaxCredentials,
    MINIMAX_DEFAULT_MODEL,
    transcribeMinimax,
} from "@/lib/transcription/minimax";

export interface TestProviderArgs {
    provider: string;
    apiKey: string;
    baseUrl?: string | null;
    defaultModel?: string | null;
}

export interface TestProviderResult {
    ok: boolean;
    /** Short human-readable detail for the UI badge. */
    detail: string;
}

/**
 * Length of the synthetic test clip sent to transcription providers.
 * Deliberately tiny: the goal is proving reachability + auth + model
 * acceptance, not transcription quality.
 */
export const TEST_AUDIO_DURATION_S = 2;

/**
 * Build a 2-second 16 kHz 16-bit mono WAV with a quiet 440 Hz tone.
 * Self-contained (no ffmpeg): every transcription surface accepts WAV,
 * and the tone keeps providers from rejecting "empty" input.
 */
export function buildTestWav(durationSeconds = TEST_AUDIO_DURATION_S): Buffer {
    const sampleRate = 16_000;
    const samples = sampleRate * durationSeconds;
    const dataSize = samples * 2; // 16-bit PCM
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < samples; i++) {
        // Quiet sine tone, amplitude ~25 % of full scale.
        const sample = Math.round(
            Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8192,
        );
        buffer.writeInt16LE(sample, 44 + i * 2);
    }

    return buffer;
}

const TEST_CHAT_PROMPT = "Reply with OK";

function truncateDetail(text: string, max = 120): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > max
        ? `${normalized.slice(0, max - 1)}…`
        : normalized;
}

/**
 * The error detail must show the REAL provider response — status code
 * first, so 404 (wrong endpoint) and 429 (quota) are clearly
 * distinguishable in the badge. OpenAI APIError and
 * MiniMaxTranscriptionError both carry a numeric `status`.
 */
function formatProviderError(error: unknown): string {
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    const status = (error as { status?: unknown } | null)?.status;
    const prefix = typeof status === "number" ? `HTTP ${status}: ` : "";
    return `${prefix}${message}`;
}

/**
 * Probe a provider configuration from the Add/Edit dialog test button.
 *
 * - "chat" providers: mini chat completion ("Reply with OK") — proves
 *   base URL, key, and model in one round trip.
 * - transcription providers (whisper/gemini/elevenlabs/minimax): sends
 *   the synthetic 2s test clip through the SAME code path production
 *   transcription uses for that style.
 *
 * MiniMax providers (preset name OR MiniMax base_url, detected via
 * isMiniMaxCredentials) have no /v1/audio/transcriptions endpoint —
 * they are tested through transcribeMinimax against
 * /v1/speech_to_text (language as an HTTP header, see minimax.ts)
 * instead of provoking a 404 on the whisper path.
 *
 * `ok` means the request completed and the provider answered; `detail`
 * carries the reply (chat) or a short confirmation for the UI badge.
 */
export async function testProviderConnection({
    provider,
    apiKey,
    baseUrl,
    defaultModel,
}: TestProviderArgs): Promise<TestProviderResult> {
    if (!apiKey) {
        return { ok: false, detail: "API key missing" };
    }

    const presetStyle = getTranscriptionStyle(provider);
    // Custom providers without a preset entry ("Custom" + their own
    // base_url) are detected as MiniMax from the base_url alone; the
    // MiniMax preset already carries the style itself.
    const style =
        presetStyle === "whisper" && isMiniMaxCredentials(provider, baseUrl)
            ? "minimax"
            : presetStyle;

    const model =
        defaultModel ||
        (style === "minimax"
            ? MINIMAX_DEFAULT_MODEL
            : (findPreset(provider)?.defaultModel ?? "whisper-1"));

    try {
        if (style === "chat") {
            const client = new OpenAI({
                apiKey,
                baseURL: baseUrl || undefined,
                timeout: env.WHISPER_REQUEST_TIMEOUT_MS,
            });
            const response = await client.chat.completions.create({
                model,
                max_tokens: 16,
                temperature: 0,
                messages: [{ role: "user", content: TEST_CHAT_PROMPT }],
            });
            const reply = response.choices[0]?.message?.content ?? "";
            if (!reply.trim()) {
                return { ok: false, detail: "Empty reply from model" };
            }
            return { ok: true, detail: truncateDetail(reply) };
        }

        const audioBuffer = buildTestWav();
        // Copy into a fresh Uint8Array so the File constructor sees a
        // plain ArrayBuffer-backed view (Buffer's ArrayBufferLike generic
        // doesn't satisfy BlobPart under TS 5.7+ typings).
        const wavBytes = new Uint8Array(audioBuffer.byteLength);
        wavBytes.set(audioBuffer);
        const file = new File([wavBytes], "riffado-test.wav", {
            type: "audio/wav",
        });

        if (style === "gemini") {
            const result = await geminiTranscribe({
                apiKey,
                model,
                audioBuffer,
                contentType: "audio/wav",
            });
            return {
                ok: true,
                detail:
                    result.text.trim().length > 0
                        ? truncateDetail(result.text)
                        : "Test audio accepted",
            };
        }

        if (style === "elevenlabs") {
            await elevenLabsTranscribe({
                apiKey,
                model,
                file,
                baseUrl,
                isHosted: env.IS_HOSTED,
                diarize: false,
                timeoutMs: env.WHISPER_REQUEST_TIMEOUT_MS,
            });
            return { ok: true, detail: "Test audio accepted" };
        }

        if (style === "minimax") {
            // Same path as production: language as an HTTP header (not a
            // form field); response_format=verbose_json is set by
            // transcribeMinimax itself.
            const result = await transcribeMinimax({
                apiKey,
                baseUrl,
                model,
                audioBuffer,
                contentType: "audio/wav",
                filename: "riffado-test.wav",
                language: "en",
                timeoutMs: env.WHISPER_REQUEST_TIMEOUT_MS,
            });
            return {
                ok: true,
                detail:
                    result.text.trim().length > 0
                        ? truncateDetail(result.text)
                        : "Test audio accepted",
            };
        }

        // "whisper" and unknown styles: OpenAI-compatible
        // /v1/audio/transcriptions, same params as production.
        const client = new OpenAI({
            apiKey,
            baseURL: baseUrl || undefined,
            timeout: env.WHISPER_REQUEST_TIMEOUT_MS,
        });
        const responseFormat = getResponseFormat(model);
        const transcription = await client.audio.transcriptions.create(
            buildTranscriptionParams({
                file,
                model,
                responseFormat,
            }),
            { timeout: env.WHISPER_REQUEST_TIMEOUT_MS },
        );
        const text =
            typeof transcription === "string"
                ? transcription
                : ((transcription as { text?: string }).text ?? "");
        return {
            ok: true,
            detail:
                text.trim().length > 0
                    ? truncateDetail(text)
                    : "Test audio accepted",
        };
    } catch (error) {
        return {
            ok: false,
            detail: truncateDetail(formatProviderError(error)),
        };
    }
}
