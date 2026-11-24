/**
 * ChatGPT plan-usage inference: request shape, SSE parsing, completion
 * semantics (only `response.completed` counts) and error mapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createChatGptResponse,
    listChatGptModels,
    parseModelList,
    readSseEvents,
} from "@/lib/ai/chatgpt/inference";
import { AppError, ErrorCode } from "@/lib/errors";

const fetchMock = vi.fn();

// `@/lib/errors` reports 5xx to PostHog, which pulls in env validation.
vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn().mockResolvedValue(undefined),
    captureServerException: vi.fn(),
}));

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Build an SSE body, optionally split into awkward chunks. */
function sseStream(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new ReadableStream({
        pull(controller) {
            if (offset >= bytes.length) {
                controller.close();
                return;
            }
            controller.enqueue(bytes.slice(offset, offset + chunkSize));
            offset += chunkSize;
        },
    });
}

function sse(events: Array<Record<string, unknown>>): string {
    return events
        .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
        .join("");
}

function streamResponse(body: string): Response {
    return new Response(sseStream(body), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
}

describe("readSseEvents", () => {
    it("reassembles events split across chunks, ignoring comments", async () => {
        const body =
            ": keepalive\n\nevent: a\ndata: 1\n\nevent: b\ndata: x\ndata: y\n\n";
        const events = [];
        for await (const e of readSseEvents(sseStream(body, 3))) events.push(e);
        expect(events).toEqual([
            { event: "a", data: "1" },
            { event: "b", data: "x\ny" },
        ]);
    });

    it("handles CRLF line endings and a trailing event without a blank line", async () => {
        const body = "event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2";
        const events = [];
        for await (const e of readSseEvents(sseStream(body))) events.push(e);
        expect(events).toEqual([
            { event: "a", data: "1" },
            { event: "b", data: "2" },
        ]);
    });
});

describe("createChatGptResponse", () => {
    const args = {
        accessToken: "at",
        model: "plan-model",
        instructions: "be brief",
        input: "transcript",
    };

    it("sends the documented plan-usage request shape", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(sse([{ type: "response.completed", response: {} }])),
        );
        await createChatGptResponse(args);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.openai.com/v1/responses");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer at");
        expect(JSON.parse(init.body)).toEqual({
            model: "plan-model",
            instructions: "be brief",
            input: [{ role: "user", content: "transcript" }],
            store: false,
            stream: true,
        });
    });

    it("concatenates output_text deltas once the response completes", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([
                    { type: "response.created" },
                    {
                        type: "response.output_text.delta",
                        delta: '{"summary":',
                    },
                    { type: "response.output_text.delta", delta: '"hi"}' },
                    { type: "response.completed", response: {} },
                ]),
            ),
        );
        await expect(createChatGptResponse(args)).resolves.toBe(
            '{"summary":"hi"}',
        );
    });

    it("falls back to the completed response's output text", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([
                    {
                        type: "response.completed",
                        response: {
                            output: [
                                {
                                    type: "message",
                                    content: [
                                        { type: "output_text", text: "Title" },
                                    ],
                                },
                            ],
                        },
                    },
                ]),
            ),
        );
        await expect(createChatGptResponse(args)).resolves.toBe("Title");
    });

    it("cancels the upstream stream once the response completes", async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        sse([{ type: "response.completed", response: {} }]),
                    ),
                );
                // Never closes: the server would keep the connection open.
            },
            cancel,
        });
        fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
        await createChatGptResponse(args);
        expect(cancel).toHaveBeenCalled();
    });

    it("fails if the stream ends without response.completed", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([{ type: "response.output_text.delta", delta: "partial" }]),
            ),
        );
        await expect(createChatGptResponse(args)).rejects.toBeInstanceOf(
            AppError,
        );
    });

    it("fails on response.incomplete", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([
                    { type: "response.output_text.delta", delta: "partial" },
                    { type: "response.incomplete", response: {} },
                ]),
            ),
        );
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_API_ERROR,
        });
    });

    it("maps a mid-stream usage-limit failure to AI_RATE_LIMITED", async () => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([
                    {
                        type: "response.failed",
                        response: {
                            error: {
                                code: "subscription_sharing_usage_limit_exceeded",
                                message: "limit",
                            },
                        },
                    },
                ]),
            ),
        );
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: ErrorCode.AI_RATE_LIMITED,
            statusCode: 429,
        });
    });

    it.each([
        [
            429,
            "subscription_sharing_usage_limit_exceeded",
            ErrorCode.AI_RATE_LIMITED,
        ],
        [
            401,
            "subscription_sharing_invalid_user",
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
        ],
        [
            403,
            "subscription_sharing_user_not_eligible",
            ErrorCode.AI_PROVIDER_API_ERROR,
        ],
        [
            503,
            "subscription_sharing_usage_unavailable",
            ErrorCode.SERVICE_UNAVAILABLE,
        ],
    ])("maps HTTP %i %s", async (status, code, expected) => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { code, message: "x" } }), {
                status,
                headers: { "Content-Type": "application/json" },
            }),
        );
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: expected,
        });
    });
});

describe("createChatGptResponse error mapping", () => {
    const args = {
        accessToken: "at",
        model: "m",
        instructions: "i",
        input: "x",
    };

    it.each([
        [
            "subscription_sharing_invalid_user",
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
        ],
        [
            "subscription_sharing_user_unavailable",
            ErrorCode.SERVICE_UNAVAILABLE,
        ],
        [
            "subscription_sharing_unsupported_capability",
            ErrorCode.AI_PROVIDER_API_ERROR,
        ],
    ])("maps an in-stream %s like its HTTP equivalent", async (code, expected) => {
        fetchMock.mockResolvedValueOnce(
            streamResponse(
                sse([
                    {
                        type: "response.failed",
                        response: { error: { code, message: "x" } },
                    },
                ]),
            ),
        );
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: expected,
        });
    });

    it("maps a timeout to SERVICE_UNAVAILABLE", async () => {
        fetchMock.mockRejectedValueOnce(
            new DOMException("The operation timed out.", "TimeoutError"),
        );
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: ErrorCode.SERVICE_UNAVAILABLE,
        });
    });

    it("maps a network failure to AI_PROVIDER_API_ERROR", async () => {
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        await expect(createChatGptResponse(args)).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_API_ERROR,
            statusCode: 502,
        });
    });

    it("maps a connection dropped mid-stream to a typed error", async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        sse([
                            { type: "response.output_text.delta", delta: "a" },
                        ]),
                    ),
                );
                controller.error(new TypeError("terminated"));
            },
        });
        fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
        await expect(createChatGptResponse(args)).rejects.toBeInstanceOf(
            AppError,
        );
    });

    it("maps a models-list network failure to a typed error", async () => {
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        await expect(listChatGptModels("at")).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_API_ERROR,
        });
    });
});

describe("models", () => {
    it("keeps only listed models and uses display names", () => {
        expect(
            parseModelList({
                models: [
                    { slug: "a", display_name: "Model A", visibility: "list" },
                    { slug: "b", display_name: "Hidden", visibility: "hide" },
                    { slug: "c" },
                    { display_name: "no slug" },
                    null,
                ],
            }),
        ).toEqual([
            { slug: "a", displayName: "Model A" },
            { slug: "c", displayName: "c" },
        ]);
        expect(parseModelList(null)).toEqual([]);
    });

    it("lists models with the bearer token", async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    models: [
                        { slug: "a", display_name: "A", visibility: "list" },
                    ],
                }),
            ),
        );
        await expect(listChatGptModels("at")).resolves.toEqual([
            { slug: "a", displayName: "A" },
        ]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.openai.com/v1/models");
        expect(init.headers.Authorization).toBe("Bearer at");
    });
});
