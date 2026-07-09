/**
 * Regression test for issue #213:
 *   "8000 limit for transcription crops important information from longer
 *    meetings"
 *
 * The summary endpoint used to hard-truncate the decrypted transcript to
 * the first 8000 characters before sending it to the model, silently
 * dropping everything after — so end-of-call decisions and action items in
 * long meetings never reached the summary. The fix removes the truncation
 * and instead maps the provider's context-window error to a clear 400 so
 * over-long transcripts fail loudly instead of being silently clipped.
 *
 * These tests cover:
 *   1. POST /api/recordings/[id]/summary sends the FULL transcript to the
 *      chat model (no 8000-char clip), including text past the old limit.
 *   2. mapErrorToAppError turns an OpenAI `context_length_exceeded` error
 *      into a 400 AI_CONTEXT_LENGTH_EXCEEDED instead of a generic 500, and
 *      maps the other provider failure classes (429 / 5xx / generic 4xx).
 */

import { APIError } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    aiEnhancements,
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { ErrorCode, mapErrorToAppError } from "@/lib/errors";

// Capture the chat-completion request without a real provider call.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

// Keep the real `APIError` (so `instanceof` in errors.ts works) but swap
// the OpenAI client for a stub that records the request params.
vi.mock("openai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("openai")>();
    return {
        ...actual,
        OpenAI: class {
            chat = { completions: { create: createMock } };
        },
        default: class {
            chat = { completions: { create: createMock } };
        },
    };
});

// Identity encryption — the route decrypts the stored transcript before
// building the prompt; we assert on the plaintext it forwards.
vi.mock("@/lib/encryption", () => ({
    decrypt: (v: string) => v,
}));
vi.mock("@/lib/encryption/fields", () => ({
    decryptText: (v: string) => v,
    encryptText: (v: string) => v,
    decryptJsonField: <T>(v: T) => v,
    encryptJsonField: <T>(v: T) => v,
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

// Per-table result queues keyed by the Drizzle table object the route
// passes to `.from(...)`. Keying by table (rather than one global
// positional array) keeps the fixture order-independent across tables:
// adding/removing/reordering a select on one table can't silently shift
// the rows returned for another. Tables queried more than once
// (apiCredentials, recordings) still consume their own queue in order.
const selectResults = new Map<unknown, unknown[][]>();

function selectChain() {
    let table: unknown;
    const c = {
        from: (t: unknown) => {
            table = t;
            return c;
        },
        where: () => c,
        for: () => c,
        orderBy: () => c,
        limit: () => Promise.resolve(selectResults.get(table)?.shift() ?? []),
    };
    return c;
}

const tx = {
    select: () => selectChain(),
    insert: () => ({ values: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
};

vi.mock("@/db", () => ({
    db: {
        select: () => selectChain(),
        transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
}));

describe("POST /api/recordings/[id]/summary — no transcript truncation (#213)", () => {
    beforeEach(() => {
        createMock.mockReset();
        selectResults.clear();
    });

    it("forwards the entire transcript to the model, including text past the old 8000-char limit", async () => {
        // > 8000 chars, with unique markers at the very start and very end.
        // The old code clipped at 8000, so END_MARKER would have been lost.
        // The `$&$1$$` sequence guards the `String.prototype.replace`
        // special-pattern bug: a string replacement would mangle it; a
        // replacement function inserts it verbatim.
        const dollarMarker = "DOLLAR_$&$1$$_MARKER";
        const transcript = `START_MARKER ${"x".repeat(20000)} ${dollarMarker} END_MARKER`;
        expect(transcript.length).toBeGreaterThan(8000);

        // recordings is selected twice: the initial lookup and the
        // still-active re-check inside the upsert transaction.
        selectResults.set(recordings, [
            [{ id: "rec-1", userId: "user-1", deletedAt: null }],
            [{ deletedAt: null }],
        ]);
        selectResults.set(transcriptions, [
            [{ recordingId: "rec-1", userId: "user-1", text: transcript }],
        ]);
        selectResults.set(userSettings, [
            [{ summaryPrompt: null, aiOutputLanguage: null }],
        ]);
        // apiCredentials is selected twice: default-enhancement then
        // default-transcription. The enhancement row wins, so the second
        // (transcription) query result is unused.
        selectResults.set(apiCredentials, [
            [
                {
                    apiKey: "enc-key",
                    baseUrl: "",
                    provider: "openai",
                    defaultModel: "gpt-4o-mini",
                    isDefaultEnhancement: true,
                    userId: "user-1",
                },
            ],
            [],
        ]);
        // No existing enhancement row -> insert path.
        selectResults.set(aiEnhancements, [[]]);

        createMock.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            summary: "s",
                            keyPoints: [],
                            actionItems: [],
                        }),
                    },
                },
            ],
        });

        const { POST } = await import(
            "@/app/api/recordings/[id]/summary/route"
        );

        const request = new Request(
            "http://localhost/api/recordings/rec-1/summary",
            {
                method: "POST",
                body: JSON.stringify({}),
                headers: { "Content-Type": "application/json" },
            },
        );
        const res = await POST(request, {
            params: Promise.resolve({ id: "rec-1" }),
        });

        expect(res.status).toBe(200);
        expect(createMock).toHaveBeenCalledTimes(1);

        const params = createMock.mock.calls[0][0] as {
            messages: { role: string; content: string }[];
        };
        const userMessage = params.messages.find((m) => m.role === "user");
        expect(userMessage).toBeDefined();
        const prompt = userMessage?.content ?? "";

        // Both ends of the transcript survive — proves no mid-transcript clip.
        expect(prompt).toContain("START_MARKER");
        expect(prompt).toContain("END_MARKER");
        // And it's not silently shortened to the old ~8000-char ceiling.
        expect(prompt.length).toBeGreaterThan(20000);
        expect(prompt).not.toContain(`${"x".repeat(20)}...`);
        // `$` sequences survive verbatim (not interpreted by replace()).
        expect(prompt).toContain(dollarMarker);
    });
});

describe("mapErrorToAppError — OpenAI provider errors (#213)", () => {
    function apiError(status: number, code: string | undefined) {
        return new APIError(
            status,
            code
                ? { code, message: `provider says ${code}` }
                : { message: "boom" },
            undefined,
            undefined,
        );
    }

    it("maps context_length_exceeded to 400 AI_CONTEXT_LENGTH_EXCEEDED", () => {
        const app = mapErrorToAppError(
            apiError(400, "context_length_exceeded"),
        );
        expect(app.statusCode).toBe(400);
        expect(app.code).toBe(ErrorCode.AI_CONTEXT_LENGTH_EXCEEDED);
    });

    it("maps 429 to AI_RATE_LIMITED", () => {
        const app = mapErrorToAppError(apiError(429, "rate_limit_exceeded"));
        expect(app.statusCode).toBe(429);
        expect(app.code).toBe(ErrorCode.AI_RATE_LIMITED);
    });

    it("maps provider 5xx to a 502 upstream error", () => {
        const app = mapErrorToAppError(apiError(503, undefined));
        expect(app.statusCode).toBe(502);
        expect(app.code).toBe(ErrorCode.UPSTREAM_BAD_RESPONSE);
    });

    it("maps a generic 4xx to 400 AI_PROVIDER_API_ERROR", () => {
        const app = mapErrorToAppError(apiError(400, "invalid_request_error"));
        expect(app.statusCode).toBe(400);
        expect(app.code).toBe(ErrorCode.AI_PROVIDER_API_ERROR);
    });

    it("does not echo the raw provider message on a generic 4xx", () => {
        const app = mapErrorToAppError(
            new APIError(
                400,
                {
                    code: "invalid_request_error",
                    message: "key sk-secret-1234 is invalid",
                },
                undefined,
                undefined,
            ),
        );
        expect(app.message).toBe("The AI provider rejected the request.");
        expect(app.message).not.toContain("sk-secret");
    });

    it("maps a connection/transport failure (no HTTP status) to 502", () => {
        // APIConnectionError / timeouts surface as an APIError with an
        // undefined status -- the provider was never reached.
        const app = mapErrorToAppError(
            new APIError(undefined, undefined, "Connection error.", undefined),
        );
        expect(app.statusCode).toBe(502);
        expect(app.code).toBe(ErrorCode.UPSTREAM_BAD_RESPONSE);
    });

    it("detects a provider context-window error reported only in the message", () => {
        // A non-OpenAI provider returns 400 without the OpenAI-specific
        // code, describing the overflow only in the message.
        const app = mapErrorToAppError(
            new APIError(
                400,
                {
                    code: "invalid_request_error",
                    message:
                        "This model's maximum context length is 8192 tokens.",
                },
                undefined,
                undefined,
            ),
        );
        expect(app.statusCode).toBe(400);
        expect(app.code).toBe(ErrorCode.AI_CONTEXT_LENGTH_EXCEEDED);
    });
});
