/**
 * SSE-streaming wrapper around the OpenAI-compatible
 * `/v1/audio/transcriptions` endpoint. Used by `transcribeRecording`
 * to surface per-segment progress instead of the previous "blocking
 * await with a spinner" UX — every emitted segment fires an
 * `onProgress` callback so the worker can write a fresh
 * `transcription_progress_seconds` value into the DB and the
 * dashboard can render a real progress bar.
 *
 * Why bypass the OpenAI SDK: the SDK's `audio.transcriptions.create`
 * doesn't expose a streaming iterator for the whisper-shaped
 * endpoint that Speaches implements; under the hood the SDK
 * collects the whole response and JSON-parses it once. Doing the
 * SSE parse ourselves keeps the request-response shape exactly
 * the SDK would have used (multipart form-data with the same
 * fields), but lets us tap each `data:` event as it arrives.
 *
 * Stream contract (Speaches / OpenAI verbose_json over SSE):
 *   data: {"task":"transcribe","language":"en","duration":11.0,
 *          "text":" ...accumulated text so far ...",
 *          "segments":[{"start":0.0,"end":11.0,"text":"...",
 *                        "avg_logprob":-0.18,"compression_ratio":1.35,
 *                        ...}],
 *          "words":null}
 *   data: ...  (next event)
 *   ...
 *
 * Speaches emits one event per generated segment (faster-whisper's
 * native segment generator behavior); the `segments` array
 * accumulates across events and the final event has the full set.
 * The OpenAI-compatible shape with `text` populated at the top
 * level on every event means we can take the last event as the
 * canonical full transcript without rebuilding it ourselves.
 *
 * The implementation is forgiving:
 *  - Any non-JSON `data:` line is skipped (e.g. `[DONE]` sentinels
 *    some providers emit at end of stream).
 *  - If no segments arrive (provider doesn't actually stream
 *    incrementally, just sends one event at the end), the
 *    onProgress callback simply never fires and the final result
 *    is still returned.
 *  - Network errors propagate; the caller's existing
 *    try/catch/finally handles claim release.
 */

type StreamSegment = {
    start?: number;
    end?: number;
    text?: string;
};

type StreamEvent = {
    text?: string;
    language?: string | null;
    duration?: number;
    segments?: StreamSegment[];
};

export interface StreamTranscribeArgs {
    /** Base URL of the OpenAI-compatible provider (without trailing slash). */
    baseUrl: string;
    /** API key for `Authorization: Bearer ...`. */
    apiKey: string;
    /** Model name, passed as the multipart `model` field. */
    model: string;
    /** Optional ISO 639-1 language hint (passed as `language`). */
    language?: string;
    /** Audio bytes. */
    file: File;
    /**
     * Called each time a new segment lands. `seconds` is the floor of
     * the latest segment's `end` value — i.e. how far into the audio
     * the transcription has advanced. Errors thrown by the callback
     * are swallowed so a flaky DB write doesn't kill the stream.
     */
    onProgress?: (seconds: number) => void | Promise<void>;
    /**
     * Optional abort signal for the underlying fetch. Forwarded to
     * fetch as `signal`; aborting cancels the HTTP request and
     * releases server-side resources (Whisper itself keeps running
     * to completion regardless — Speaches doesn't tear down the
     * underlying transcribe job on client disconnect, but we at
     * least stop reading the response).
     */
    signal?: AbortSignal;
}

export interface StreamTranscribeResult {
    text: string;
    detectedLanguage: string | null;
    /** The highest segment-end-seconds value we saw — 0 if the
     *  provider didn't stream segments at all (single-event reply). */
    finalProgressSeconds: number;
}

/**
 * POSTs the file to `{baseUrl}/audio/transcriptions` with
 * `stream=true` + `response_format=verbose_json` and folds the SSE
 * events into a single final result. `onProgress` fires per segment.
 */
export async function streamTranscribe(
    args: StreamTranscribeArgs,
): Promise<StreamTranscribeResult> {
    const form = new FormData();
    form.append("file", args.file);
    form.append("model", args.model);
    form.append("response_format", "verbose_json");
    form.append("stream", "true");
    if (args.language) form.append("language", args.language);

    const url = `${args.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${args.apiKey}` },
        body: form,
        signal: args.signal,
    });

    if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(
            `Transcription provider ${response.status}: ${detail.slice(0, 500)}`,
        );
    }

    let lastEvent: StreamEvent | null = null;
    let maxProgressSeconds = 0;
    // Accumulate segments across events keyed by start time. Speaches
    // (observed empirically) sends ONE segment per event, and the
    // top-level `text` field on each event contains only THAT segment's
    // text — not an accumulating transcript. The single-segment JFK
    // probe was misleading because `text` and `segments[0].text` were
    // identical for an 11-second clip. For a real 4-minute file, taking
    // the last event's `text` gave us only the closing sentence and
    // dropped the prior 99% of the transcript. Track segments by start
    // and reassemble at the end. Using a Map keyed on `start` also
    // de-dupes if a provider ever re-emits the same segment.
    const accumulatedSegments = new Map<number, StreamSegment>();

    for await (const chunk of iterateSseEvents(response.body)) {
        const event = parseEvent(chunk);
        if (!event) continue;
        lastEvent = event;

        if (event.segments && event.segments.length > 0) {
            for (const seg of event.segments) {
                if (typeof seg.start === "number") {
                    accumulatedSegments.set(seg.start, seg);
                }
            }
            const latestEnd = Math.max(
                ...event.segments
                    .map((s) => (typeof s.end === "number" ? s.end : 0))
                    .filter((n) => Number.isFinite(n) && n > 0),
            );
            if (latestEnd > maxProgressSeconds) {
                maxProgressSeconds = latestEnd;
                if (args.onProgress) {
                    try {
                        await args.onProgress(Math.floor(latestEnd));
                    } catch (err) {
                        // Progress is observation-only; never let it
                        // sink the actual transcription job.
                        console.error("onProgress callback failed:", err);
                    }
                }
            }
        }
    }

    if (!lastEvent) {
        throw new Error("Transcription stream closed before any event arrived");
    }

    // Prefer the reconstructed text from accumulated segments — that's
    // the source of truth across multi-event streams. Fall back to the
    // last event's `text` for providers that send a single final event
    // (e.g. OpenAI whisper-1's non-streaming-like response with
    // `stream=true`), since in that case there's only one segment and
    // it lives on the same event.
    const reconstructedText = Array.from(accumulatedSegments.values())
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
        .map((s) => (typeof s.text === "string" ? s.text : ""))
        .join("")
        .trim();
    const fallbackText =
        typeof lastEvent.text === "string" ? lastEvent.text.trim() : "";

    return {
        text: reconstructedText || fallbackText,
        detectedLanguage:
            typeof lastEvent.language === "string" ? lastEvent.language : null,
        finalProgressSeconds: Math.floor(maxProgressSeconds),
    };
}

/**
 * Yields decoded text payloads from an SSE response body. Each yielded
 * string is the content of one `data: ` line; multi-line `data:`
 * concatenation per the SSE spec is supported. `[DONE]` sentinels and
 * non-data lines (event:, id:, retry:, comments) are silently dropped
 * so the consumer only sees real payloads.
 */
async function* iterateSseEvents(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Events are separated by a blank line ("\n\n"). Process
            // every complete event in the buffer; keep the remainder.
            let sep = buffer.indexOf("\n\n");
            while (sep !== -1) {
                const raw = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const payload = collectDataLines(raw);
                if (payload && payload !== "[DONE]") yield payload;
                sep = buffer.indexOf("\n\n");
            }
        }

        // Flush a final event that wasn't terminated by "\n\n" — some
        // SSE servers (incl. Speaches in observed traffic) end the
        // stream on the last byte of the last event's body.
        const tail = buffer.trim();
        if (tail) {
            const payload = collectDataLines(tail);
            if (payload && payload !== "[DONE]") yield payload;
        }
    } finally {
        reader.releaseLock();
    }
}

function collectDataLines(rawEvent: string): string | null {
    const parts: string[] = [];
    for (const line of rawEvent.split("\n")) {
        if (line.startsWith("data:")) {
            // Per SSE spec, a single leading space after the colon is
            // a separator, not part of the value. Strip it but only it.
            const content = line.slice(5);
            parts.push(content.startsWith(" ") ? content.slice(1) : content);
        }
    }
    if (parts.length === 0) return null;
    return parts.join("\n");
}

function parseEvent(raw: string): StreamEvent | null {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        return parsed as StreamEvent;
    } catch {
        // Provider might emit a non-JSON keep-alive (": ping\n" or
        // similar). Skip silently rather than fail the whole stream.
        return null;
    }
}
