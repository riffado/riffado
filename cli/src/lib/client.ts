/**
 * HTTP client for the Riffado `/api/v1/*` surface.
 *
 * Responsibilities:
 *   - inject `Authorization: Bearer <key>` and `User-Agent`
 *   - decode the unified `{error, code, details?}` envelope on non-2xx
 *   - honor `Retry-After` on 429 with bounded backoff
 *   - surface ApiError to callers with both `code` (machine-readable) and
 *     `message` (human-readable from the server)
 *
 * Streaming endpoints (audio download) bypass `request()` and use the
 * lower-level `rawFetch()` so the response body can be piped to disk.
 */

import { USER_AGENT } from "./version.js";

export type ErrorEnvelope = {
    error: string;
    code: string;
    details?: Record<string, unknown>;
};

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: Record<string, unknown>;

    constructor(status: number, envelope: ErrorEnvelope) {
        super(envelope.error);
        this.name = "ApiError";
        this.status = status;
        this.code = envelope.code;
        this.details = envelope.details;
    }
}

export class NetworkError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown,
    ) {
        super(message);
        this.name = "NetworkError";
    }
}

export type ClientOptions = {
    server: string;
    apiKey: string;
    /** Override fetch (tests). Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Max retries on 429 / 5xx (default 3). */
    maxRetries?: number;
    /** Sleep function (tests). Defaults to setTimeout. */
    sleep?: (ms: number) => Promise<void>;
};

export type RequestOptions = {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    query?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    /** If true, do not follow redirects (used by audio download). */
    redirect?: "follow" | "manual";
    /** If true, return the raw Response instead of parsed JSON. */
    raw?: boolean;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_SLEEP = (ms: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

function buildUrl(
    server: string,
    path: string,
    query?: RequestOptions["query"],
): string {
    const base = server.endsWith("/") ? server.slice(0, -1) : server;
    const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

function parseRetryAfter(header: string | null): number | null {
    if (!header) return null;
    const seconds = Number.parseInt(header, 10);
    if (Number.isInteger(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
        const delta = date - Date.now();
        return delta > 0 ? delta : 0;
    }
    return null;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.error === "string" && typeof obj.code === "string";
}

async function decodeErrorBody(response: Response): Promise<ErrorEnvelope> {
    const text = await response.text();
    if (text.length === 0) {
        return {
            error: `Request failed with status ${response.status}`,
            code: "UNKNOWN_ERROR",
        };
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (isErrorEnvelope(parsed)) return parsed;
        return {
            error: `Unexpected error body: ${text.slice(0, 200)}`,
            code: "UNKNOWN_ERROR",
        };
    } catch {
        return {
            error: `Non-JSON error response: ${text.slice(0, 200)}`,
            code: "UNKNOWN_ERROR",
        };
    }
}

export class ApiClient {
    private readonly server: string;
    private readonly apiKey: string;
    private readonly fetchImpl: typeof fetch;
    private readonly maxRetries: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(options: ClientOptions) {
        this.server = options.server;
        this.apiKey = options.apiKey;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.sleep = options.sleep ?? DEFAULT_SLEEP;
    }

    /**
     * Low-level fetch wrapper. Adds auth + UA; does not retry; does not
     * parse the body. Callers that need streaming (audio) use this.
     */
    async rawFetch(
        path: string,
        init?: RequestInit & { query?: RequestOptions["query"] },
    ): Promise<Response> {
        const { query, headers, ...rest } = init ?? {};
        const url = buildUrl(this.server, path, query);
        const mergedHeaders = new Headers(headers);
        mergedHeaders.set("Authorization", `Bearer ${this.apiKey}`);
        mergedHeaders.set("User-Agent", USER_AGENT);
        try {
            return await this.fetchImpl(url, {
                ...rest,
                headers: mergedHeaders,
            });
        } catch (error) {
            throw new NetworkError(
                `Failed to reach ${this.server}: ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
        }
    }

    /**
     * High-level JSON request with envelope decoding and 429 backoff.
     * Throws `ApiError` on non-2xx after retries are exhausted.
     */
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const { method = "GET", query, body, redirect = "follow" } = options;
        const headers = new Headers();
        const init: RequestInit & { query?: RequestOptions["query"] } = {
            method,
            redirect,
            query,
            headers,
        };
        if (body !== undefined) {
            headers.set("Content-Type", "application/json");
            init.body = JSON.stringify(body);
        }

        let attempt = 0;
        for (;;) {
            const response = await this.rawFetch(path, init);
            if (response.ok) {
                if (response.status === 204) return undefined as T;
                if (options.raw) return response as unknown as T;
                return (await response.json()) as T;
            }

            // Retryable: 429 (rate limited) and 5xx (server transient).
            const retryable =
                response.status === 429 ||
                (response.status >= 500 && response.status < 600);

            if (retryable && attempt < this.maxRetries) {
                const retryAfterMs =
                    parseRetryAfter(response.headers.get("retry-after")) ??
                    Math.min(2 ** attempt * 500, 8_000);
                // Drain the body so the connection can be reused.
                try {
                    await response.text();
                } catch {
                    // ignore
                }
                attempt += 1;
                await this.sleep(retryAfterMs);
                continue;
            }

            const envelope = await decodeErrorBody(response);
            throw new ApiError(response.status, envelope);
        }
    }
}
