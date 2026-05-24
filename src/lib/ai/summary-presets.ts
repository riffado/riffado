export type SummaryPreset =
    | "general"
    | "meeting-notes"
    | "key-points"
    | "action-items";

export interface SummaryPromptConfig {
    id: SummaryPreset;
    name: string;
    description: string;
    prompt: string;
}

export interface CustomSummaryPrompt {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
}

export interface SummaryPromptConfiguration {
    /** Preset id or custom prompt id. */
    selectedPrompt: string;
    customPrompts: CustomSummaryPrompt[];
}

export const SUMMARY_PRESETS: Record<SummaryPreset, SummaryPromptConfig> = {
    general: {
        id: "general",
        name: "General Summary",
        description: "Concise summary of any audio transcription",
        prompt: `Provide a concise summary of this audio transcription. Then extract key points and action items if any exist.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A concise paragraph summarizing the transcription",
  "keyPoints": ["key point 1", "key point 2"],
  "actionItems": ["action item 1", "action item 2"]
}

If there are no key points or action items, return empty arrays.

Transcription:
{transcription}`,
    },
    "meeting-notes": {
        id: "meeting-notes",
        name: "Meeting Notes",
        description:
            "Structured meeting summary with attendees, decisions, and action items",
        prompt: `Summarize this meeting recording. Include attendees mentioned, decisions made, and action items.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A structured summary of the meeting including attendees and decisions",
  "keyPoints": ["decision 1", "decision 2", "key discussion point"],
  "actionItems": ["action item with owner if mentioned", "follow-up task"]
}

If there are no key points or action items, return empty arrays.

Transcription:
{transcription}`,
    },
    "key-points": {
        id: "key-points",
        name: "Key Points",
        description: "Extract the key points as a bullet list",
        prompt: `Extract the key points from this transcription. Focus on the most important information, facts, and insights.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A brief one-sentence overview of the transcription",
  "keyPoints": ["key point 1", "key point 2", "key point 3"],
  "actionItems": []
}

Transcription:
{transcription}`,
    },
    "action-items": {
        id: "action-items",
        name: "Action Items",
        description:
            "Extract all action items, tasks, and follow-ups mentioned",
        prompt: `Extract all action items, tasks, and follow-ups mentioned in this transcription. Include who is responsible if mentioned.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A brief overview of what was discussed",
  "keyPoints": [],
  "actionItems": ["action item 1 (owner if known)", "task 2", "follow-up 3"]
}

If there are no action items, return an empty array but still provide a summary.

Transcription:
{transcription}`,
    },
};

export function getSummaryPromptForPreset(preset: SummaryPreset): string {
    return SUMMARY_PRESETS[preset].prompt;
}

export function getDefaultSummaryPromptConfig(): SummaryPromptConfiguration {
    return {
        selectedPrompt: "general",
        customPrompts: [],
    };
}

export function getAllSummaryPrompts(
    config: SummaryPromptConfiguration,
): Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    isPreset: boolean;
}> {
    const presets = Object.values(SUMMARY_PRESETS).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prompt: p.prompt,
        isPreset: true,
    }));

    const customs = config.customPrompts.map((p) => ({
        id: p.id,
        name: p.name,
        description: "Custom prompt",
        prompt: p.prompt,
        isPreset: false,
    }));

    return [...presets, ...customs];
}

export interface AiOutputLanguageOption {
    code: string;
    label: string;
}

export const AI_OUTPUT_LANGUAGES: readonly AiOutputLanguageOption[] = [
    { code: "auto", label: "Auto (match transcript)" },
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
    { code: "fr", label: "French" },
    { code: "de", label: "German" },
    { code: "it", label: "Italian" },
    { code: "pt", label: "Portuguese" },
    { code: "nl", label: "Dutch" },
    { code: "pl", label: "Polish" },
    { code: "ru", label: "Russian" },
    { code: "tr", label: "Turkish" },
    { code: "uk", label: "Ukrainian" },
    { code: "cs", label: "Czech" },
    { code: "sv", label: "Swedish" },
    { code: "da", label: "Danish" },
    { code: "no", label: "Norwegian" },
    { code: "fi", label: "Finnish" },
    { code: "el", label: "Greek" },
    { code: "ro", label: "Romanian" },
    { code: "hu", label: "Hungarian" },
    { code: "ja", label: "Japanese" },
    { code: "zh", label: "Chinese (Simplified)" },
    { code: "ko", label: "Korean" },
    { code: "ar", label: "Arabic" },
    { code: "he", label: "Hebrew" },
    { code: "hi", label: "Hindi" },
    { code: "id", label: "Indonesian" },
    { code: "vi", label: "Vietnamese" },
    { code: "th", label: "Thai" },
] as const;

const LANGUAGE_CODES = new Set(AI_OUTPUT_LANGUAGES.map((l) => l.code));

/** Validate against `AI_OUTPUT_LANGUAGES`; returns the code or null. */
export function normalizeAiOutputLanguage(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return LANGUAGE_CODES.has(value) ? value : null;
}

/**
 * Directive sentence for the model. Three branches:
 *
 *   - explicit non-auto code → "Write everything in <Label>".
 *   - `auto` (or unset) AND we know the transcript's detected language →
 *     "Write everything in <Label of detected>". Matches the user's
 *     mental model of "Auto = match transcript", which the previous
 *     implementation broke: a null directive let the model fall back
 *     on the prompt template's English context and produce English
 *     summaries for German transcripts.
 *   - `auto` AND no detected language hint → soft instruction asking
 *     the model to mirror the transcript's language itself. This is
 *     the path for legacy rows without `detected_language` populated
 *     and for transcription providers that don't return a language
 *     code.
 */
export function getAiOutputLanguageDirective(
    code: string | null | undefined,
    transcriptLanguage?: string | null,
): string | null {
    if (code && code !== "auto") {
        const match = AI_OUTPUT_LANGUAGES.find((l) => l.code === code);
        if (!match) return null;
        return `IMPORTANT: Write all natural-language output in ${match.label}, regardless of the transcription's language. Keep any JSON keys in English exactly as specified.`;
    }
    if (transcriptLanguage) {
        const match = AI_OUTPUT_LANGUAGES.find(
            (l) => l.code === transcriptLanguage,
        );
        if (match) {
            return `IMPORTANT: Write all natural-language output in ${match.label} (matching the transcription's detected language). Keep any JSON keys in English exactly as specified.`;
        }
    }
    return "IMPORTANT: Write all natural-language output in the same language as the transcription. Keep any JSON keys in English exactly as specified.";
}

export function getSummaryPromptById(
    id: string,
    config: SummaryPromptConfiguration,
): string | null {
    if (id in SUMMARY_PRESETS) {
        return SUMMARY_PRESETS[id as SummaryPreset].prompt;
    }

    const custom = config.customPrompts.find((p) => p.id === id);
    return custom?.prompt || null;
}
