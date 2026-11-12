/**
 * MiniMax ASR client.
 *
 * Verified API facts (benchmarked against the live service):
 * - Endpoint: POST {host}/v1/speech_to_text — NOT /audio/transcriptions.
 *   A provider row typically carries base_url "https://api.minimax.io/v1";
 *   the endpoint keeps the /v1 prefix and replaces everything after it
 *   with /speech_to_text.
 * - Auth: bearer key.
 * - Multipart fields: model (e.g. "asr-1.0"), response_format
 *   ("verbose_json"), file.
 * - IMPORTANT: language (BCP-47, e.g. "de") is sent as an HTTP HEADER,
 *   not as a form field — a common integration mistake.
 * - Limits: 500 s duration / 50 MB per request (hence the chunking in
 *   chunk-audio.ts with safety margins).
 * - verbose_json returns: text, duration, n_speakers,
 *   segments[{start, end, speaker, text}] with speaker labels S1/S2/...
 */

export const MINIMAX_DEFAULT_MODEL = "asr-1.0";

const MINIMAX_SPEECH_TO_TEXT_PATH = "/v1/speech_to_text";

export interface MiniMaxSegment {
    start: number;
    end: number;
    speaker: string;
    text: string;
}

export interface MiniMaxVerboseTranscription {
    text: string;
    duration?: number;
    n_speakers?: number;
    segments?: MiniMaxSegment[];
}

/**
 * Detects MiniMax credentials, even when the provider was named freely
 * ("Custom" preset with a MiniMax base_url). Name and host matching are
 * deliberately tolerant so rows can be labeled however the user likes.
 */
export function isMiniMaxCredentials(
    provider: string,
    baseUrl: string | null | undefined,
): boolean {
    if (/minimax/i.test(provider)) return true;
    if (baseUrl) {
        try {
            return new URL(baseUrl).hostname.includes("minimax");
        } catch {
            return /minimax/i.test(baseUrl);
        }
    }
    return false;
}

/**
 * Derives the speech_to_text endpoint from the provider base_url.
 * "https://api.minimax.io/v1" -> "https://api.minimax.io/v1/speech_to_text".
 * Without base_url the public MiniMax host is used.
 */
export function buildMinimaxSpeechToTextUrl(
    baseUrl: string | null | undefined,
): string {
    if (!baseUrl) {
        return `https://api.minimax.io${MINIMAX_SPEECH_TO_TEXT_PATH}`;
    }
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    // Row URLs typically end in /v1 — strip everything from the /v1 onward
    // so neither /v1/v1 nor /v1/audio/transcriptions can be produced.
    const withV1 = /\/v\d+(?:\/beta)?$/.test(trimmed)
        ? trimmed.replace(/\/v\d+(?:\/beta)?$/, "")
        : trimmed;
    return `${withV1}${MINIMAX_SPEECH_TO_TEXT_PATH}`;
}

/**
 * Dedicated error type so transcribe-recording only trips its fallback
 * chain on MiniMax errors and re-throws foreign ones. `retryable` marks
 * 429/5xx/timeout — everything that justifies a later retry (or a switch
 * to another provider).
 */
export class MiniMaxTranscriptionError extends Error {
    readonly status: number | undefined;
    readonly retryable: boolean;

    constructor(
        message: string,
        opts: { status?: number; retryable?: boolean } = {},
    ) {
        super(message);
        this.name = "MiniMaxTranscriptionError";
        this.status = opts.status;
        this.retryable =
            opts.retryable ??
            (opts.status === 429 ||
                (opts.status !== undefined && opts.status >= 500));
    }
}

export interface TranscribeMinimaxArgs {
    apiKey: string;
    /** Provider base_url (.../v1) or empty for the public MiniMax host. */
    baseUrl?: string | null;
    model?: string;
    audioBuffer: Buffer;
    contentType: string;
    filename: string;
    /** BCP-47, e.g. "de". Sent as an HTTP HEADER, not a form field. */
    language?: string;
    timeoutMs: number;
    /** Injectable for tests — defaults to globalThis.fetch. */
    fetchImpl?: typeof fetch;
}

/**
 * Sends a single audio segment to MiniMax speech_to_text and parses the
 * verbose_json response. Throws MiniMaxTranscriptionError on HTTP errors
 * and timeouts (the latter are retryable).
 */
export async function transcribeMinimax({
    apiKey,
    baseUrl,
    model = MINIMAX_DEFAULT_MODEL,
    audioBuffer,
    contentType,
    filename,
    language,
    timeoutMs,
    fetchImpl = fetch,
}: TranscribeMinimaxArgs): Promise<MiniMaxVerboseTranscription> {
    const url = buildMinimaxSpeechToTextUrl(baseUrl);

    const form = new FormData();
    form.set("model", model);
    form.set("response_format", "verbose_json");
    const view = new Uint8Array(
        audioBuffer.buffer as ArrayBuffer,
        audioBuffer.byteOffset,
        audioBuffer.byteLength,
    );
    form.set(
        "file",
        new File([view], filename, {
            type: contentType || "application/octet-stream",
        }),
    );

    const headers = new Headers({ authorization: `Bearer ${apiKey}` });
    if (language) {
        // BCP-47 as a header — see the module docblock; deliberately NOT a
        // form field.
        headers.set("language", language);
    }

    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            headers,
            body: form,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
            throw new MiniMaxTranscriptionError(
                `MiniMax request exceeded the ${timeoutMs} ms timeout`,
                { retryable: true },
            );
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new MiniMaxTranscriptionError(
                `MiniMax request aborted (timeout ${timeoutMs} ms)`,
                { retryable: true },
            );
        }
        throw new MiniMaxTranscriptionError(
            `MiniMax request failed: ${error instanceof Error ? error.message : String(error)}`,
            { retryable: true },
        );
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new MiniMaxTranscriptionError(
            `MiniMax speech_to_text responded with ${response.status}: ${body.slice(0, 300)}`,
            { status: response.status },
        );
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error) {
        throw new MiniMaxTranscriptionError(
            `MiniMax response is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const parsed = payload as Partial<MiniMaxVerboseTranscription>;
    if (typeof parsed.text !== "string") {
        throw new MiniMaxTranscriptionError(
            "MiniMax response contains no 'text' entry",
        );
    }

    return {
        text: parsed.text,
        duration:
            typeof parsed.duration === "number" ? parsed.duration : undefined,
        n_speakers:
            typeof parsed.n_speakers === "number"
                ? parsed.n_speakers
                : undefined,
        segments: Array.isArray(parsed.segments)
            ? parsed.segments
                  .filter(
                      (s): s is MiniMaxSegment =>
                          !!s &&
                          typeof (s as MiniMaxSegment).start === "number" &&
                          typeof (s as MiniMaxSegment).end === "number" &&
                          typeof (s as MiniMaxSegment).speaker === "string" &&
                          typeof (s as MiniMaxSegment).text === "string",
                  )
                  .map((s) => ({
                      start: s.start,
                      end: s.end,
                      speaker: s.speaker,
                      text: s.text,
                  }))
            : undefined,
    };
}
