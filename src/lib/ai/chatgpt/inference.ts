/**
 * Inference against the user's ChatGPT plan.
 *
 * Plan usage only covers the Responses API, and OpenAI requires
 * `stream: true` and `store: false`. A request only counts as
 * successful once `response.completed` arrives, so we collect the
 * streamed text and fail on `response.failed` / `response.incomplete`.
 *
 * Plain `fetch` + a minimal SSE reader instead of the OpenAI SDK: the
 * request shape is fixed by OpenAI's plan-usage docs, and the models
 * endpoint returns a plan-specific shape the SDK doesn't model.
 */

import { AppError, ErrorCode } from "@/lib/errors";
import {
    CHATGPT_BASE_URL,
    CHATGPT_PROVIDER_NAME,
    reconnectError,
} from "./shared";

const RESPONSES_URL = `${CHATGPT_BASE_URL}/responses`;
const MODELS_URL = `${CHATGPT_BASE_URL}/models`;

/** Long transcripts can take a while to summarize. */
const RESPONSE_TIMEOUT_MS = 180_000;
const MODELS_TIMEOUT_MS = 15_000;

export interface ChatGptModel {
    slug: string;
    displayName: string;
}

interface OpenAiErrorBody {
    error?: { code?: unknown; message?: unknown; type?: unknown } | null;
}

function errorCodeOf(body: OpenAiErrorBody | null): string | null {
    const code = body?.error?.code;
    return typeof code === "string" ? code : null;
}

/**
 * Map an HTTP failure (before the stream starts) to a user-facing error,
 * following OpenAI's plan-usage error table.
 */
export function mapChatGptHttpError(
    status: number,
    body: OpenAiErrorBody | null,
): AppError {
    const code = errorCodeOf(body);
    const details = { provider: CHATGPT_PROVIDER_NAME, upstreamCode: code };

    if (
        code === "subscription_sharing_usage_limit_exceeded" ||
        status === 429
    ) {
        return new AppError(
            ErrorCode.AI_RATE_LIMITED,
            "You've hit the ChatGPT plan usage limit for Riffado. Check your usage in ChatGPT settings, or switch AI enhancements to another provider for now.",
            429,
            details,
        );
    }
    if (code === "subscription_sharing_invalid_user" || status === 401) {
        return reconnectError();
    }
    if (code === "subscription_sharing_user_not_eligible") {
        return new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "This ChatGPT account or workspace isn't eligible to use its plan in other apps.",
            403,
            details,
        );
    }
    if (code === "subscription_sharing_unsupported_capability") {
        return new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "ChatGPT rejected the request as unsupported for plan usage. Try a different model in Settings → Providers.",
            400,
            details,
        );
    }
    if (
        status === 503 ||
        code === "subscription_sharing_usage_unavailable" ||
        code === "subscription_sharing_user_unavailable"
    ) {
        return new AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "ChatGPT plan usage is temporarily unavailable. Try again in a moment.",
            503,
            details,
        );
    }
    if (status === 403) {
        return new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "ChatGPT refused the request for this account. Reconnect ChatGPT in Settings → Providers if this keeps happening.",
            403,
            details,
        );
    }
    return new AppError(
        ErrorCode.AI_PROVIDER_API_ERROR,
        `ChatGPT request failed (${status}).`,
        502,
        details,
    );
}

/**
 * HTTP status OpenAI documents for each plan-usage error code. Used to
 * map errors that arrive inside the stream (`response.failed` / `error`
 * events), where there's no HTTP status, through the same table.
 */
const PLAN_ERROR_STATUS: Record<string, number> = {
    subscription_sharing_usage_limit_exceeded: 429,
    subscription_sharing_invalid_user: 401,
    subscription_sharing_user_not_eligible: 403,
    subscription_sharing_unsupported_capability: 400,
    subscription_sharing_route_not_supported: 403,
    subscription_sharing_usage_unavailable: 503,
    subscription_sharing_user_unavailable: 503,
    chatpass_v2_scope_not_authorized: 403,
};

/**
 * Map a network failure or timeout talking to OpenAI to a typed
 * provider error instead of letting it surface as an INTERNAL_ERROR 500.
 */
export function mapChatGptTransportError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
        return new AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "ChatGPT took too long to respond. Try again in a moment.",
            503,
            { provider: CHATGPT_PROVIDER_NAME },
        );
    }
    return new AppError(
        ErrorCode.AI_PROVIDER_API_ERROR,
        "Couldn't reach ChatGPT. Check the server's internet connection and try again.",
        502,
        { provider: CHATGPT_PROVIDER_NAME },
    );
}

async function fetchChatGpt(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (error) {
        throw mapChatGptTransportError(error);
    }
}

async function readErrorBody(
    response: Response,
): Promise<OpenAiErrorBody | null> {
    return (await response.json().catch(() => null)) as OpenAiErrorBody | null;
}

export async function listChatGptModels(
    accessToken: string,
): Promise<ChatGptModel[]> {
    const response = await fetchChatGpt(MODELS_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw mapChatGptHttpError(
            response.status,
            await readErrorBody(response),
        );
    }
    const data = (await response.json().catch(() => null)) as {
        models?: unknown;
    } | null;
    return parseModelList(data);
}

/** Plan models come back as `{ models: [{ slug, display_name, visibility }] }`. */
export function parseModelList(
    data: { models?: unknown } | null,
): ChatGptModel[] {
    const raw = Array.isArray(data?.models) ? data.models : [];
    const models: ChatGptModel[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        if (m.visibility !== undefined && m.visibility !== "list") continue;
        if (typeof m.slug !== "string" || !m.slug) continue;
        models.push({
            slug: m.slug,
            displayName:
                typeof m.display_name === "string" && m.display_name
                    ? m.display_name
                    : m.slug,
        });
    }
    return models;
}

interface SseEvent {
    event: string | null;
    data: string;
}

/** Minimal `text/event-stream` reader: yields one event per blank line. */
export async function* readSseEvents(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName: string | null = null;
    let dataLines: string[] = [];

    const flush = (): SseEvent | null => {
        if (dataLines.length === 0) {
            eventName = null;
            return null;
        }
        const evt = { event: eventName, data: dataLines.join("\n") };
        eventName = null;
        dataLines = [];
        return evt;
    };

    const processLine = (line: string): SseEvent | null => {
        if (line === "") return flush();
        if (line.startsWith(":")) return null;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
        return null;
    };

    // Release the upstream connection however the consumer stops: early
    // `break` on response.completed, a thrown stream error, or EOF.
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline !== -1) {
                const line = buffer.slice(0, newline).replace(/\r$/, "");
                buffer = buffer.slice(newline + 1);
                const evt = processLine(line);
                if (evt) yield evt;
                newline = buffer.indexOf("\n");
            }
        }
        buffer += decoder.decode();
        if (buffer) {
            const evt = processLine(buffer.replace(/\r$/, ""));
            if (evt) yield evt;
        }
        const last = flush();
        if (last) yield last;
    } finally {
        reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Pull output text out of a completed response object (fallback path). */
function outputTextFromResponse(response: unknown): string {
    const output = (response as { output?: unknown } | null)?.output;
    if (!Array.isArray(output)) return "";
    let text = "";
    for (const item of output) {
        const content = (item as { content?: unknown } | null)?.content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            const p = part as { type?: unknown; text?: unknown } | null;
            if (p?.type === "output_text" && typeof p.text === "string") {
                text += p.text;
            }
        }
    }
    return text;
}

function streamFailure(message: string): AppError {
    return new AppError(ErrorCode.AI_PROVIDER_API_ERROR, message, 502, {
        provider: CHATGPT_PROVIDER_NAME,
    });
}

/**
 * Run one text generation on the user's ChatGPT plan and return the
 * full output text. `instructions` carries the system prompt.
 */
export async function createChatGptResponse(args: {
    accessToken: string;
    model: string;
    instructions: string;
    input: string;
}): Promise<string> {
    const response = await fetchChatGpt(RESPONSES_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${args.accessToken}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
        },
        body: JSON.stringify({
            model: args.model,
            instructions: args.instructions,
            input: [{ role: "user", content: args.input }],
            store: false,
            stream: true,
        }),
        signal: AbortSignal.timeout(RESPONSE_TIMEOUT_MS),
    });

    if (!response.ok || !response.body) {
        throw mapChatGptHttpError(
            response.status,
            await readErrorBody(response),
        );
    }

    let text = "";
    let completed = false;

    try {
        for await (const evt of readSseEvents(response.body)) {
            if (evt.data === "[DONE]") break;
            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(evt.data);
            } catch {
                continue;
            }
            const type =
                typeof payload.type === "string" ? payload.type : evt.event;

            if (type === "response.output_text.delta") {
                if (typeof payload.delta === "string") text += payload.delta;
            } else if (type === "response.completed") {
                completed = true;
                if (!text) text = outputTextFromResponse(payload.response);
                break;
            } else if (type === "response.failed" || type === "error") {
                const err =
                    (
                        payload.response as
                            | { error?: { code?: unknown; message?: unknown } }
                            | undefined
                    )?.error ??
                    (payload.error as
                        | { code?: unknown; message?: unknown }
                        | undefined) ??
                    payload;
                const code = typeof err?.code === "string" ? err.code : null;
                if (code && PLAN_ERROR_STATUS[code]) {
                    throw mapChatGptHttpError(PLAN_ERROR_STATUS[code], {
                        error: { code },
                    });
                }
                const message =
                    typeof err?.message === "string" ? err.message : null;
                throw streamFailure(
                    message
                        ? `ChatGPT request failed: ${message}`
                        : "ChatGPT request failed.",
                );
            } else if (type === "response.incomplete") {
                throw streamFailure(
                    "ChatGPT stopped before finishing the response. Try again, or use a shorter recording.",
                );
            }
        }
    } catch (error) {
        // Timeouts or dropped connections mid-stream.
        throw mapChatGptTransportError(error);
    }

    if (!completed) {
        throw streamFailure("ChatGPT ended the response early. Try again.");
    }
    return text;
}
