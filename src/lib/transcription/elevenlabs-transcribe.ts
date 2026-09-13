/**
 * ElevenLabs Scribe speech-to-text.
 *
 * Not OpenAI-compatible: auth is `xi-api-key` (not `Authorization: Bearer`),
 * the endpoint is `/speech-to-text`, and the response shape is its own
 * (`words[]` with per-word `speaker_id`, not the OpenAI `segments[]`
 * shape used by `format.ts`). Kept as its own module rather than forced
 * through `chat-transcribe.ts` / the OpenAI SDK.
 */

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

// ElevenLabs advertises a 5 GB per-request limit, far beyond OpenAI's
// 25 MiB. The whole buffer is still materialized in memory (same as every
// other provider path today), so cap well under that to avoid OOMing the
// transcription worker on a pathological upload. The real enforcement
// point is `downloadFileWithLimit` in `transcribe-recording.ts`, which
// aborts the download before the buffer is fully materialized; the check
// below is a last-resort assertion for any caller that hands in an
// already-materialized `File`.
export const ELEVENLABS_MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

function isTransientStatus(status: number): boolean {
    return (
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 524
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `retry-after` header value (seconds) into milliseconds, capped. */
function retryAfterMs(header: string | null): number | null {
    if (!header) return null;
    const seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

// ISO 639-3 (and other non-standard codes ElevenLabs may return) mapped to
// the ISO 639-1 codes the rest of Riffado stores/displays
// (`transcriptions.detectedLanguage`, the language badge, the settings
// dropdown). Unknown codes pass through unchanged.
const LANGUAGE_CODE_MAP: Record<string, string> = {
    eng: "en",
    deu: "de",
    ger: "de",
    fra: "fr",
    fre: "fr",
    spa: "es",
    ita: "it",
    nld: "nl",
    dut: "nl",
    por: "pt",
    pol: "pl",
    ces: "cs",
    cze: "cs",
    ukr: "uk",
    rus: "ru",
    ron: "ro",
    rum: "ro",
    hun: "hu",
    ell: "el",
    gre: "el",
    tur: "tr",
    ara: "ar",
    heb: "he",
    hin: "hi",
    ind: "id",
    vie: "vi",
    tha: "th",
    zho: "zh",
    chi: "zh",
    jpn: "ja",
    kor: "ko",
};

function normalizeLanguageCode(code: string | null | undefined): string | null {
    if (!code) return null;
    const lower = code.trim().toLowerCase();
    if (!lower) return null;
    const mapped = LANGUAGE_CODE_MAP[lower] ?? lower;
    return mapped.slice(0, 10);
}

export class ElevenLabsTranscribeError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = "ElevenLabsTranscribeError";
    }
}

export class ElevenLabsFileTooLargeError extends Error {
    constructor(public sizeBytes: number) {
        super(
            `Audio file (${Math.round(sizeBytes / 1024 / 1024)} MB) exceeds the ` +
                `${ELEVENLABS_MAX_FILE_BYTES / 1024 / 1024} MB limit for ElevenLabs transcription.`,
        );
        this.name = "ElevenLabsFileTooLargeError";
    }
}

interface ElevenLabsWord {
    text: string;
    type?: "word" | "spacing" | "audio_event";
    speaker_id?: string | null;
}

interface ElevenLabsTranscriptionResponse {
    text?: string;
    language_code?: string | null;
    language_probability?: number | null;
    words?: ElevenLabsWord[];
}

export interface ElevenLabsTranscribeArgs {
    apiKey: string;
    model: string;
    file: File;
    /** Base URL from the stored credential; falls back to the public API. */
    baseUrl?: string | null;
    /** ISO language code. Omit/undefined for auto-detect. */
    language?: string;
    diarize: boolean;
    /** Optional 1..32 speaker-count hint. Ignored when `diarize` is false. */
    numSpeakers?: number;
    /** Per-attempt request timeout. */
    timeoutMs: number;
}

export interface ElevenLabsTranscribeResult {
    text: string;
    detectedLanguage: string | null;
    /** Distinct speakers found. 0 when diarization was off or none detected. */
    speakerCount: number;
}

/**
 * Groups diarized words into `Speaker N: ...` lines, in the same format
 * `src/lib/plaud/content.ts` already produces for Plaud-imported
 * transcripts, so the transcript panel's existing renderer needs no
 * change. Raw `speaker_id` values are mapped to 1-based numbers in order
 * of first appearance.
 */
function formatDiarizedText(words: ElevenLabsWord[]): {
    text: string;
    speakerCount: number;
} {
    const speakerNumbers = new Map<string, number>();
    const lines: { speaker: number; text: string }[] = [];

    for (const word of words) {
        if (word.type === "audio_event") continue;
        const speakerId = word.speaker_id;
        if (!speakerId) {
            // No speaker attribution on this word -- fall back to plain
            // concatenation below.
            return {
                text: words
                    .filter((w) => w.type !== "audio_event")
                    .map((w) => w.text)
                    .join("")
                    .trim(),
                speakerCount: 0,
            };
        }

        let speakerNumber = speakerNumbers.get(speakerId);
        if (speakerNumber === undefined) {
            speakerNumber = speakerNumbers.size + 1;
            speakerNumbers.set(speakerId, speakerNumber);
        }

        const last = lines.at(-1);
        if (last && last.speaker === speakerNumber) {
            last.text += word.text;
        } else {
            lines.push({ speaker: speakerNumber, text: word.text });
        }
    }

    const text = lines
        .filter((line) => line.text.trim() !== "")
        .map((line) => `Speaker ${line.speaker}: ${line.text.trim()}`)
        .join("\n");

    return { text, speakerCount: speakerNumbers.size };
}

async function postSpeechToText(args: {
    baseUrl: string;
    apiKey: string;
    form: FormData;
    timeoutMs: number;
}): Promise<ElevenLabsTranscriptionResponse> {
    const { baseUrl, apiKey, form, timeoutMs } = args;
    const url = `${baseUrl}/speech-to-text`;

    let attempt = 0;
    for (;;) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "xi-api-key": apiKey },
                body: form,
                signal: controller.signal,
            });

            if (response.ok) {
                return (await response.json()) as ElevenLabsTranscriptionResponse;
            }

            if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
                const delay =
                    retryAfterMs(response.headers.get("retry-after")) ??
                    Math.min(
                        INITIAL_RETRY_DELAY_MS * 2 ** attempt,
                        MAX_RETRY_DELAY_MS,
                    );
                await response.text().catch(() => "");
                attempt += 1;
                console.warn(
                    `[elevenlabs] transcription request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
                );
                await sleep(delay);
                continue;
            }

            const detail = await response.text().catch(() => "");
            console.error(
                `[elevenlabs] transcription request failed (${response.status}): ${detail.slice(0, 2000)}`,
            );

            if (response.status === 401 || response.status === 403) {
                throw new ElevenLabsTranscribeError(
                    response.status,
                    "ElevenLabs rejected the API key.",
                );
            }
            if (response.status === 422) {
                throw new ElevenLabsTranscribeError(
                    422,
                    "ElevenLabs rejected the transcription request (invalid parameters).",
                );
            }
            throw new ElevenLabsTranscribeError(
                response.status,
                `ElevenLabs returned ${response.status} while transcribing.`,
            );
        } catch (err) {
            // A non-retryable status error raised above must propagate as-is
            // -- it is not a network failure and must not be reinterpreted
            // as one by the fallback handling below.
            if (err instanceof ElevenLabsTranscribeError) {
                throw err;
            }

            const isAbort = (err as Error).name === "AbortError";
            if (attempt < MAX_RETRIES) {
                const delay = Math.min(
                    INITIAL_RETRY_DELAY_MS * 2 ** attempt,
                    MAX_RETRY_DELAY_MS,
                );
                attempt += 1;
                console.warn(
                    `[elevenlabs] transcription request ${isAbort ? "timed out" : "failed to reach ElevenLabs"}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
                );
                await sleep(delay);
                continue;
            }

            if (isAbort) {
                throw new ElevenLabsTranscribeError(
                    504,
                    "Timed out waiting for ElevenLabs to transcribe the audio.",
                );
            }
            throw new ElevenLabsTranscribeError(
                502,
                "Failed to reach ElevenLabs.",
            );
        } finally {
            clearTimeout(timer);
        }
    }
}

export async function elevenLabsTranscribe(
    args: ElevenLabsTranscribeArgs,
): Promise<ElevenLabsTranscribeResult> {
    const {
        apiKey,
        model,
        file,
        baseUrl,
        language,
        diarize,
        numSpeakers,
        timeoutMs,
    } = args;

    if (file.size > ELEVENLABS_MAX_FILE_BYTES) {
        throw new ElevenLabsFileTooLargeError(file.size);
    }

    const effectiveBaseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

    const form = new FormData();
    form.append("file", file);
    form.append("model_id", model);
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    form.append("diarize", String(diarize));
    if (language) {
        form.append("language_code", language);
    }
    if (
        diarize &&
        numSpeakers !== undefined &&
        Number.isInteger(numSpeakers) &&
        numSpeakers >= 1 &&
        numSpeakers <= 32
    ) {
        form.append("num_speakers", String(numSpeakers));
    }

    const response = await postSpeechToText({
        baseUrl: effectiveBaseUrl,
        apiKey,
        form,
        timeoutMs,
    });

    const words = response.words ?? [];
    const { text, speakerCount } =
        diarize && words.length > 0
            ? formatDiarizedText(words)
            : { text: (response.text ?? "").trim(), speakerCount: 0 };

    if (!text) {
        throw new Error(
            "ElevenLabs returned an empty transcription. The audio may be silent or the model may not have recognised the content.",
        );
    }

    return {
        text,
        detectedLanguage: normalizeLanguageCode(response.language_code),
        speakerCount,
    };
}
