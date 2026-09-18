/**
 * ElevenLabs Scribe speech-to-text.
 *
 * Not OpenAI-compatible: auth is `xi-api-key` (not `Authorization: Bearer`),
 * the endpoint is `/speech-to-text`, and the response shape is its own
 * (`words[]` with per-word `speaker_id`, not the OpenAI `segments[]`
 * shape used by `format.ts`). Kept as its own module rather than forced
 * through `chat-transcribe.ts` / the OpenAI SDK.
 */

import { z } from "zod";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";
const OFFICIAL_ELEVENLABS_ORIGINS = [
    "https://api.elevenlabs.io",
    "https://api.eu.elevenlabs.io",
] as const;
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 5_000_000;
const MAX_WORDS = 500_000;

// ElevenLabs advertises a 5 GB request limit. Riffado uses a much lower cap
// for predictable disk, network, and provider-cost exposure. The storage path
// is spooled to a bounded temporary file; this check also protects direct
// callers that hand in an already-created File.
export const ELEVENLABS_MAX_FILE_BYTES = 128 * 1024 * 1024;

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
    constructor(public sizeBytes?: number) {
        super(
            sizeBytes === undefined
                ? `Audio file exceeds the ${ELEVENLABS_MAX_FILE_BYTES / 1024 / 1024} MB limit for ElevenLabs transcription.`
                : `Audio file (${Math.round(sizeBytes / 1024 / 1024)} MB) exceeds the ` +
                      `${ELEVENLABS_MAX_FILE_BYTES / 1024 / 1024} MB limit for ElevenLabs transcription.`,
        );
        this.name = "ElevenLabsFileTooLargeError";
    }
}

const elevenLabsWordSchema = z.object({
    text: z.string().max(1024),
    type: z.enum(["word", "spacing", "audio_event"]).optional(),
    speaker_id: z.string().max(128).nullable().optional(),
});

const elevenLabsTranscriptionResponseSchema = z.object({
    text: z.string().max(MAX_TRANSCRIPT_CHARS).optional(),
    language_code: z.string().max(16).nullable().optional(),
    language_probability: z.number().min(0).max(1).nullable().optional(),
    words: z.array(elevenLabsWordSchema).max(MAX_WORDS).optional(),
});

type ElevenLabsWord = z.infer<typeof elevenLabsWordSchema>;
type ElevenLabsTranscriptionResponse = z.infer<
    typeof elevenLabsTranscriptionResponseSchema
>;

export interface ElevenLabsTranscribeArgs {
    apiKey: string;
    model: string;
    file: File;
    /** Base URL from the stored credential; falls back to the public API. */
    baseUrl?: string | null;
    /** Hosted mode only permits ElevenLabs' official API endpoint. */
    isHosted?: boolean;
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

export const ELEVENLABS_HOSTED_BASE_URL_MESSAGE =
    "Hosted ElevenLabs transcription only supports ElevenLabs' official API (https://api.elevenlabs.io/v1 or https://api.eu.elevenlabs.io/v1). Self-host Riffado to use a custom proxy.";

export const ELEVENLABS_BASE_URL_MESSAGE =
    "ElevenLabs base URL must be an http(s) URL without credentials.";

type ParsedElevenLabsBaseUrl =
    | { kind: "default" }
    | { kind: "url"; url: URL }
    | { kind: "invalid" };

function parseOptionalElevenLabsBaseUrl(
    input: unknown,
): ParsedElevenLabsBaseUrl {
    if (input == null) return { kind: "default" };
    if (typeof input !== "string") return { kind: "invalid" };
    const trimmed = input.trim();
    if (!trimmed) return { kind: "default" };
    try {
        return { kind: "url", url: new URL(trimmed) };
    } catch {
        return { kind: "invalid" };
    }
}

function isOfficialElevenLabsBaseUrl(url: URL): boolean {
    const pathname = url.pathname.replace(/\/+$/, "");
    return (
        (OFFICIAL_ELEVENLABS_ORIGINS as readonly string[]).includes(
            url.origin,
        ) &&
        pathname === "/v1" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
    );
}

function isAllowedSelfHostElevenLabsBaseUrl(url: URL): boolean {
    return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.username === "" &&
        url.password === ""
    );
}

function normalizeElevenLabsBaseUrl(url: URL): string {
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function speechToTextUrl(baseUrl: string): string {
    return new URL("speech-to-text", `${baseUrl}/`).href;
}

export function resolveElevenLabsBaseUrl(
    input: unknown,
    { isHosted }: { isHosted: boolean },
): { ok: true; baseUrl: string } | { ok: false; message: string } {
    const parsed = parseOptionalElevenLabsBaseUrl(input);
    if (parsed.kind === "invalid") {
        return {
            ok: false,
            message: isHosted
                ? ELEVENLABS_HOSTED_BASE_URL_MESSAGE
                : ELEVENLABS_BASE_URL_MESSAGE,
        };
    }
    if (parsed.kind === "default") {
        return { ok: true, baseUrl: DEFAULT_BASE_URL };
    }
    if (isHosted) {
        return isOfficialElevenLabsBaseUrl(parsed.url)
            ? { ok: true, baseUrl: normalizeElevenLabsBaseUrl(parsed.url) }
            : { ok: false, message: ELEVENLABS_HOSTED_BASE_URL_MESSAGE };
    }
    return isAllowedSelfHostElevenLabsBaseUrl(parsed.url)
        ? { ok: true, baseUrl: normalizeElevenLabsBaseUrl(parsed.url) }
        : { ok: false, message: ELEVENLABS_BASE_URL_MESSAGE };
}

/** Validate the ElevenLabs endpoint without weakening self-host proxy support. */
export function validateElevenLabsBaseUrl(
    input: unknown,
    { isHosted }: { isHosted: boolean },
): { ok: true } | { ok: false; message: string } {
    const resolved = resolveElevenLabsBaseUrl(input, { isHosted });
    return resolved.ok ? { ok: true } : resolved;
}

function flattenWordText(text: string): string {
    return text.replace(/[\r\n]+/g, " ");
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
        const wordText = flattenWordText(word.text);
        if (!speakerId) {
            return {
                text: words
                    .filter((w) => w.type !== "audio_event")
                    .map((w) => flattenWordText(w.text))
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
            last.text += wordText;
        } else {
            lines.push({ speaker: speakerNumber, text: wordText });
        }
    }

    const text = lines
        .filter((line) => line.text.trim() !== "")
        .map((line) => `Speaker ${line.speaker}: ${line.text.trim()}`)
        .join("\n");

    return { text, speakerCount: speakerNumbers.size };
}

async function discardResponseBody(response: Response): Promise<void> {
    if (response.body) {
        await response.body.cancel().catch(() => undefined);
    }
}

async function readResponseBody(response: Response): Promise<string> {
    if (!response.body) return "";
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) {
        await discardResponseBody(response);
        throw new ElevenLabsTranscribeError(
            502,
            "ElevenLabs returned an oversized transcription response.",
        );
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new ElevenLabsTranscribeError(
                502,
                "ElevenLabs returned an oversized transcription response.",
            );
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function parseTranscriptionResponse(
    response: Response,
): Promise<ElevenLabsTranscriptionResponse> {
    const body = await readResponseBody(response);
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        throw new ElevenLabsTranscribeError(
            502,
            "ElevenLabs returned an invalid transcription response.",
        );
    }

    const parsed = elevenLabsTranscriptionResponseSchema.safeParse(json);
    if (!parsed.success) {
        throw new ElevenLabsTranscribeError(
            502,
            "ElevenLabs returned an invalid transcription response.",
        );
    }
    return parsed.data;
}

async function postSpeechToText(args: {
    baseUrl: string;
    apiKey: string;
    form: FormData;
    timeoutMs: number;
}): Promise<ElevenLabsTranscriptionResponse> {
    const { baseUrl, apiKey, form, timeoutMs } = args;
    const url = speechToTextUrl(baseUrl);

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
                redirect: "error",
            });

            if (response.ok) {
                return await parseTranscriptionResponse(response);
            }

            if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
                const delay =
                    retryAfterMs(response.headers.get("retry-after")) ??
                    Math.min(
                        INITIAL_RETRY_DELAY_MS * 2 ** attempt,
                        MAX_RETRY_DELAY_MS,
                    );
                await discardResponseBody(response);
                attempt += 1;
                console.warn(
                    `[elevenlabs] transcription request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
                );
                await sleep(delay);
                continue;
            }

            await discardResponseBody(response);
            console.error(
                `[elevenlabs] transcription request failed (${response.status})`,
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
        isHosted = false,
        language,
        diarize,
        numSpeakers,
        timeoutMs,
    } = args;

    if (file.size > ELEVENLABS_MAX_FILE_BYTES) {
        throw new ElevenLabsFileTooLargeError(file.size);
    }
    if (typeof model !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(model)) {
        throw new ElevenLabsTranscribeError(
            400,
            "Invalid ElevenLabs transcription model.",
        );
    }
    if (typeof diarize !== "boolean") {
        throw new ElevenLabsTranscribeError(
            400,
            "Invalid ElevenLabs diarization setting.",
        );
    }
    if (
        diarize &&
        numSpeakers !== undefined &&
        (!Number.isInteger(numSpeakers) || numSpeakers < 1 || numSpeakers > 32)
    ) {
        throw new ElevenLabsTranscribeError(
            400,
            "ElevenLabs speaker count must be between 1 and 32.",
        );
    }
    if (
        language !== undefined &&
        !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)
    ) {
        throw new ElevenLabsTranscribeError(
            400,
            "Invalid ElevenLabs language code.",
        );
    }

    const resolvedBaseUrl = resolveElevenLabsBaseUrl(baseUrl, { isHosted });
    if (!resolvedBaseUrl.ok) {
        throw new ElevenLabsTranscribeError(400, resolvedBaseUrl.message);
    }
    const effectiveBaseUrl = resolvedBaseUrl.baseUrl;

    const form = new FormData();
    form.append("file", file);
    form.append("model_id", model);
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    form.append("diarize", String(diarize));
    if (language) {
        form.append("language_code", language);
    }
    if (diarize && numSpeakers !== undefined) {
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
