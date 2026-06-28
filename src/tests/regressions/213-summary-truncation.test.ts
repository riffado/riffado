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

// Queue of rows consumed (in order) by each `.limit(1)` select.
const selectResults: unknown[][] = [];

function selectChain() {
    const c = {
        from: () => c,
        where: () => c,
        for: () => c,
        orderBy: () => c,
        limit: () => Promise.resolve(selectResults.shift() ?? []),
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
        selectResults.length = 0;
    });

    it("forwards the entire transcript to the model, including text past the old 8000-char limit", async () => {
        // > 8000 chars, with unique markers at the very start and very end.
        // The old code clipped at 8000, so END_MARKER would have been lost.
        const transcript = `START_MARKER ${"x".repeat(20000)} END_MARKER`;
        expect(transcript.length).toBeGreaterThan(8000);

        selectResults.push(
            [{ id: "rec-1", userId: "user-1", deletedAt: null }], // recording
            [{ recordingId: "rec-1", userId: "user-1", text: transcript }], // transcription
            [{ summaryPrompt: null, aiOutputLanguage: null }], // userSettings
            [
                {
                    apiKey: "enc-key",
                    baseUrl: "",
                    provider: "openai",
                    defaultModel: "gpt-4o-mini",
                    isDefaultEnhancement: true,
                    userId: "user-1",
                },
            ], // enhancement credentials
            [], // transcription credentials (unused)
            [{ deletedAt: null }], // still-active re-check inside the tx
            [], // no existing enhancement -> insert path
        );

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
});
