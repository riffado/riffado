import { type Dispatcher, getGlobalDispatcher } from "undici";

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;
const SOCKET_CLOSED_RETRY_WINDOW_MS = 5000;

const NOT_CONNECTED_ERROR_CODES = new Set([
    "ECONNREFUSED",
    "ConnectionRefused",
    "ENOTFOUND",
]);

const SOCKET_CLOSED_ERROR_CODES = new Set(["ECONNRESET", "UND_ERR_SOCKET"]);

const transcriptionDispatcher = {
    dispatch(
        options: Dispatcher.DispatchOptions,
        handler: Dispatcher.DispatchHandler,
    ) {
        return getGlobalDispatcher().dispatch(
            { ...options, headersTimeout: 0, bodyTimeout: 0 },
            handler,
        );
    },
};

/** Options for {@link fetchTranscription}. */
export interface FetchTranscriptionOptions {
    /**
     * Retry HTTP 429 and connection failures raised before any response, at
     * most twice. Default `true`. Disable for callers that run their own
     * retry loop over those failures.
     */
    retry?: boolean;
}

function stringCode(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const code = (value as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}

function retryableConnectionErrorCode(
    error: unknown,
    elapsedMs: number,
): string | undefined {
    if (!(error instanceof Error)) return undefined;
    if (error.name === "AbortError" || error.name === "TimeoutError") {
        return undefined;
    }
    const code = stringCode(error) ?? stringCode(error.cause);
    if (code === undefined) return undefined;
    if (NOT_CONNECTED_ERROR_CODES.has(code)) return code;
    if (
        SOCKET_CLOSED_ERROR_CODES.has(code) &&
        elapsedMs < SOCKET_CLOSED_RETRY_WINDOW_MS
    ) {
        return code;
    }
    return undefined;
}

function hasReplayableBody(
    input: string | URL | Request,
    body: RequestInit["body"],
): boolean {
    if (input instanceof Request && input.body !== null) return false;
    if (body === undefined || body === null) return true;
    if (body instanceof ReadableStream) return false;
    return !(typeof body === "object" && Symbol.asyncIterator in body);
}

function backoffMs(attempt: number): number {
    return INITIAL_RETRY_DELAY_MS * 2 ** attempt;
}

function retryAfterMs(header: string | null): number | undefined {
    const value = header?.trim();
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return seconds >= 0
            ? Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
            : undefined;
    }
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Apply a transcription deadline through response-body consumption. The
 * deadline covers every attempt and backoff. Unless `retry` is `false`,
 * HTTP 429, refused connections, unresolved hosts, and sockets closed within
 * 5s of the attempt starting are retried up to twice, honouring
 * `Retry-After` (capped at 30s) or backing off 1s then 2s. Other statuses,
 * later socket closes, timeouts and aborts are never retried, and neither is
 * a request whose body cannot be replayed.
 */
export async function fetchTranscription(
    input: string | URL | Request,
    init: RequestInit,
    timeoutMs: number,
    { retry = true }: FetchTranscriptionOptions = {},
): Promise<Response> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const callerSignal =
        init.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal
        ? AbortSignal.any([callerSignal, deadline])
        : deadline;
    const requestInit = {
        ...init,
        signal,
        timeout: false,
        ...(!process.versions.bun
            ? { dispatcher: transcriptionDispatcher }
            : {}),
    };
    const maxRetries =
        retry && hasReplayableBody(input, init.body) ? MAX_RETRIES : 0;

    for (let attempt = 0; ; attempt += 1) {
        let response: Response;
        const attemptStartedAt = Date.now();
        try {
            response = await fetch(input, requestInit);
        } catch (error) {
            const code = retryableConnectionErrorCode(
                error,
                Date.now() - attemptStartedAt,
            );
            if (attempt >= maxRetries || signal.aborted || !code) {
                throw error;
            }
            const delay = backoffMs(attempt);
            console.warn(
                `[transcription] connection failed before a response (${code}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
            );
            await sleep(delay, signal);
            continue;
        }

        if (response.status !== 429 || attempt >= maxRetries) {
            return response;
        }
        const delay =
            retryAfterMs(response.headers.get("retry-after")) ??
            backoffMs(attempt);
        await response.body?.cancel().catch(() => undefined);
        console.warn(
            `[transcription] provider returned 429, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(delay, signal);
    }
}
