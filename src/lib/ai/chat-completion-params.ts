import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

/**
 * OpenAI deprecated `max_tokens` for newer model families and replaced it
 * with `max_completion_tokens`. Sending `max_tokens` to one of these models
 * is rejected at the API boundary with HTTP 400:
 *   `Unsupported parameter: 'max_tokens' is not supported with this model.
 *    Use 'max_completion_tokens' instead.`
 *
 * The affected families share a stable prefix in their model names:
 *   - `gpt-5*` (gpt-5, gpt-5-mini, gpt-5-nano, ...)
 *   - `o1*`, `o3*`, `o4*` reasoning models
 *
 * Non-OpenAI providers reached through the OpenAI-compatible chat API
 * (Groq, Together, OpenRouter, ...) keep accepting `max_tokens`, so the
 * switch is opt-in by model name rather than blanket.
 */
const MAX_COMPLETION_TOKENS_PREFIXES = ["gpt-5", "o1", "o3", "o4"] as const;

export function usesMaxCompletionTokens(model: string): boolean {
    const m = model.toLowerCase();
    return MAX_COMPLETION_TOKENS_PREFIXES.some((p) => m.startsWith(p));
}

/**
 * Build the parameter object passed to `openai.chat.completions.create`.
 *
 * Centralised so every call site picks the right token-limit parameter for
 * the configured model without each site re-implementing the detection.
 */
export function buildChatCompletionParams(args: {
    model: string;
    messages: ChatCompletionCreateParamsNonStreaming["messages"];
    temperature: number;
    maxTokens: number;
}): ChatCompletionCreateParamsNonStreaming {
    const { model, messages, temperature, maxTokens } = args;

    const base = {
        model,
        messages,
        temperature,
    };

    if (usesMaxCompletionTokens(model)) {
        return { ...base, max_completion_tokens: maxTokens };
    }
    return { ...base, max_tokens: maxTokens };
}

// Reasoning models (Qwen3 on Groq, DeepSeek R1, some proxies) can return
// their reasoning inline as `<think>...</think>` before the answer.
const REASONING_OPEN_AT_START = /^<think(?:ing)?>/i;
const REASONING_OPEN = /<think(?:ing)?>/i;
const REASONING_CLOSE = /<\/think(?:ing)?>/i;
const REASONING_CLOSE_ALL = /<\/think(?:ing)?>/gi;

/**
 * Answer text of a chat completion without leading inline reasoning.
 * Reasoning comes before the answer, so only these shapes are stripped:
 * - The reply starts with an opening tag: drop that block. Repeat while the
 *   rest starts with another block. An opening tag with no closing tag means
 *   the token budget ran out during the reasoning: there is no answer.
 * - A closing tag comes before any opening tag: the reply started inside
 *   the reasoning (some chat templates put the opening tag in the prompt),
 *   so drop everything up to the last such closing tag.
 * Tag text in the middle of an answer (a transcript about this markup) is
 * left as it is.
 */
export function stripReasoning(content: string | null | undefined): string {
    if (typeof content !== "string") return "";
    let text = content.trim();
    while (REASONING_OPEN_AT_START.test(text)) {
        const close = REASONING_CLOSE.exec(text);
        if (!close) return "";
        text = text.slice(close.index + close[0].length).trim();
    }
    const firstOpen = text.search(REASONING_OPEN);
    let answerStart = -1;
    for (const match of text.matchAll(REASONING_CLOSE_ALL)) {
        if (firstOpen !== -1 && match.index > firstOpen) break;
        answerStart = match.index + match[0].length;
    }
    return answerStart === -1 ? text : text.slice(answerStart).trim();
}
