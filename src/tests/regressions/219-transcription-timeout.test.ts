/**
 * Regression: issue #219
 *
 * The OpenAI Node SDK defaults to a 10-minute request timeout. Long
 * recordings die in the UI with "request timed out" even when the
 * provider later finishes. Whisper-style already overrides per-request
 * via WHISPER_REQUEST_TIMEOUT_MS (default 60 min, #183). The chat-style
 * path (OpenRouter) used the same client without a timeout and hit the
 * same 10-minute abort.
 */

import type { OpenAI } from "openai";
import { describe, expect, it, vi } from "vitest";

const TIMEOUT_MS = 60 * 60 * 1000;

vi.mock("@/lib/env", () => ({
    env: { WHISPER_REQUEST_TIMEOUT_MS: TIMEOUT_MS },
}));

import { chatTranscribe } from "@/lib/transcription/chat-transcribe";

describe("issue #219 — chat-style transcription uses the long request timeout", () => {
    it("passes WHISPER_REQUEST_TIMEOUT_MS to chat.completions.create", async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: "hello from chat" } }],
        });
        const client = {
            chat: { completions: { create } },
        } as unknown as OpenAI;

        const result = await chatTranscribe({
            client,
            model: "google/gemini-2.5-flash-lite",
            audioBuffer: Buffer.from("fake-mp3"),
            contentType: "audio/mpeg",
        });

        expect(result.text).toBe("hello from chat");
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[1]).toEqual({ timeout: TIMEOUT_MS });
    });
});
