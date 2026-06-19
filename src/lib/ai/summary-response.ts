/**
 * Parse an LLM summary response into the stored shape
 * `{ summary: string, keyPoints: string[], actionItems: string[] }`.
 *
 * Hardened for custom summary prompts (issue #199): the four built-in
 * presets pin the exact JSON contract, so in practice the model returns
 * a string `summary`. A user-authored custom prompt has no such
 * guarantee — it can make the model emit prose, a different JSON shape,
 * or a `summary` that is a nested object. None of that may crash the
 * summary route: `summary` in particular must always be a string before
 * it reaches `encryptText`, which throws on non-string input. Array
 * elements are coerced too, since the UI renders them as text and an
 * object element would otherwise blow up React rendering on read-back.
 */

export interface ParsedSummary {
    summary: string;
    keyPoints: string[];
    actionItems: string[];
}

const coerceToString = (value: unknown): string =>
    typeof value === "string" ? value : JSON.stringify(value);

export function parseSummaryResponse(rawContent: string): ParsedSummary {
    const trimmed = rawContent.trim();

    try {
        // Strip markdown code fences if present.
        const cleanContent = trimmed
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        const parsed = JSON.parse(cleanContent);

        const hasStringSummary = typeof parsed.summary === "string";
        const summary = hasStringSummary ? parsed.summary : "";
        const keyPoints = Array.isArray(parsed.keyPoints)
            ? parsed.keyPoints.map(coerceToString)
            : [];
        const actionItems = Array.isArray(parsed.actionItems)
            ? parsed.actionItems.map(coerceToString)
            : [];

        // Keep a present-but-empty summary string as-is (e.g. a custom
        // prompt that asks for bullet points only and leaves summary
        // blank). Only when the JSON carried no usable content at all —
        // no string summary and no points — do we fall back to the raw
        // model output; otherwise a legitimately empty summary would be
        // replaced by the raw JSON blob.
        const hasUsableContent =
            hasStringSummary || keyPoints.length > 0 || actionItems.length > 0;

        return {
            summary: hasUsableContent ? summary : trimmed,
            keyPoints,
            actionItems,
        };
    } catch {
        // Not JSON — treat the whole response as the summary text.
        return { summary: trimmed, keyPoints: [], actionItems: [] };
    }
}
