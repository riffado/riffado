/**
 * Server-side scaffolding for summary generation. Custom summary prompts
 * (issue #199) should carry only the user's *intent* — Riffado owns the
 * output-shape contract and guarantees the transcript reaches the model.
 * This keeps the JSON schema out of the user's hands: the built-in
 * presets still embed it (harmless, reinforcing), but a hand-written
 * custom prompt needs nothing more than "summarize this, emphasize X".
 *
 * Pairs with `parseSummaryResponse` (the read side): this builds the
 * request so the model is told the shape; that parses the response and
 * degrades gracefully if the model deviates anyway.
 */

const TRANSCRIPTION_PLACEHOLDER = "{transcription}";

/**
 * Canonical output contract injected into the system message for every
 * summary call. Stating the exact shape server-side is what lets custom
 * prompts omit it. Kept in sync with `parseSummaryResponse`'s expected
 * `{ summary, keyPoints, actionItems }` shape.
 */
export const SUMMARY_OUTPUT_CONTRACT = [
    "Respond with a single valid JSON object and nothing else — no markdown, no code fences, no commentary.",
    "The object must have exactly these keys:",
    '- "summary": a string containing a concise prose summary of the transcription.',
    '- "keyPoints": an array of strings (use [] when there are none).',
    '- "actionItems": an array of strings (use [] when there are none).',
].join("\n");

/**
 * Build the user message from a prompt template + transcript. Substitutes
 * every `{transcription}` placeholder; if the template has none (a custom
 * prompt that forgot it), the transcript is appended so it always reaches
 * the model rather than being silently dropped.
 */
export function buildSummaryUserPrompt(
    template: string,
    transcription: string,
): string {
    if (template.includes(TRANSCRIPTION_PLACEHOLDER)) {
        return template.replaceAll(TRANSCRIPTION_PLACEHOLDER, transcription);
    }
    return `${template}\n\nTranscription:\n${transcription}`;
}

/**
 * Build the system message: role + the output contract, plus an optional
 * output-language directive. The contract lives here (not in the user
 * prompt) so the shape requirement is constant across presets and customs.
 */
export function buildSummarySystemMessage(
    languageDirective?: string | null,
): string {
    const parts = [
        "You are a helpful assistant that summarizes audio transcriptions.",
        SUMMARY_OUTPUT_CONTRACT,
    ];
    if (languageDirective) {
        parts.push(languageDirective);
    }
    return parts.join("\n\n");
}
