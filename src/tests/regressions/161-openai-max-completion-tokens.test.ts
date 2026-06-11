/**
 * Regression: OpenAI gpt-5 and reasoning-model families reject `max_tokens`.
 *
 * Before this fix, both call sites — `POST /api/recordings/[id]/summary`
 * and `generateTitleFromTranscription` — built the chat-completion request
 * with a hardcoded `max_tokens` parameter. When a user configured a
 * `gpt-5*` or `o*` model in their AI-enhancement provider, every call
 * failed at the OpenAI API boundary with HTTP 400:
 *   `Unsupported parameter: 'max_tokens' is not supported with this model.
 *    Use 'max_completion_tokens' instead.`
 *
 * The fix introduces a shared `buildChatCompletionParams` helper that
 * inspects the model name and picks the right token-limit parameter. Both
 * call sites go through that helper, so a future call site cannot reopen
 * the bug by re-implementing the param object inline.
 *
 * Non-OpenAI providers reachable through the OpenAI-compatible chat API
 * (Groq, Together, OpenRouter, ...) still accept `max_tokens`, so the
 * swap is opt-in by model-name prefix rather than blanket.
 */

import { describe, expect, it } from "vitest";
import {
    buildChatCompletionParams,
    usesMaxCompletionTokens,
} from "@/lib/ai/chat-completion-params";

describe("usesMaxCompletionTokens — model-name detection", () => {
    it.each([
        ["gpt-5", true],
        ["gpt-5-mini", true],
        ["gpt-5-nano", true],
        ["GPT-5-mini", true],
        ["o1", true],
        ["o1-mini", true],
        ["o3-mini", true],
        ["o4-mini", true],
        ["gpt-4o", false],
        ["gpt-4o-mini", false],
        ["gpt-4.1", false],
        ["gpt-4.1-mini", false],
        ["gpt-3.5-turbo", false],
        ["llama-3.1-8b-instant", false],
        ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", false],
    ])("model %s -> %s", (model, expected) => {
        expect(usesMaxCompletionTokens(model)).toBe(expected);
    });
});

describe("buildChatCompletionParams — picks the right token-limit param", () => {
    const messages = [
        { role: "system" as const, content: "you are a helper" },
        { role: "user" as const, content: "hi" },
    ];

    it("sends max_completion_tokens for gpt-5-mini", () => {
        const params = buildChatCompletionParams({
            model: "gpt-5-mini",
            messages,
            temperature: 0.5,
            maxTokens: 2000,
        });
        expect(
            (params as { max_completion_tokens?: number })
                .max_completion_tokens,
        ).toBe(2000);
        expect((params as { max_tokens?: number }).max_tokens).toBeUndefined();
    });

    it("sends max_completion_tokens for o-series reasoning models", () => {
        const params = buildChatCompletionParams({
            model: "o3-mini",
            messages,
            temperature: 1,
            maxTokens: 4000,
        });
        expect(
            (params as { max_completion_tokens?: number })
                .max_completion_tokens,
        ).toBe(4000);
        expect((params as { max_tokens?: number }).max_tokens).toBeUndefined();
    });

    it("keeps max_tokens for gpt-4o-mini (default model)", () => {
        const params = buildChatCompletionParams({
            model: "gpt-4o-mini",
            messages,
            temperature: 0.5,
            maxTokens: 2000,
        });
        expect((params as { max_tokens?: number }).max_tokens).toBe(2000);
        expect(
            (params as { max_completion_tokens?: number })
                .max_completion_tokens,
        ).toBeUndefined();
    });

    it("keeps max_tokens for non-OpenAI provider models (Groq, OpenRouter)", () => {
        const groqParams = buildChatCompletionParams({
            model: "llama-3.1-8b-instant",
            messages,
            temperature: 0.5,
            maxTokens: 2000,
        });
        expect((groqParams as { max_tokens?: number }).max_tokens).toBe(2000);

        const openrouterParams = buildChatCompletionParams({
            model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
            messages,
            temperature: 0.5,
            maxTokens: 2000,
        });
        expect((openrouterParams as { max_tokens?: number }).max_tokens).toBe(
            2000,
        );
    });

    it("forwards model, messages, and temperature verbatim", () => {
        const params = buildChatCompletionParams({
            model: "gpt-4o-mini",
            messages,
            temperature: 0.7,
            maxTokens: 50,
        });
        expect(params.model).toBe("gpt-4o-mini");
        expect(params.messages).toEqual(messages);
        expect(params.temperature).toBe(0.7);
    });
});
