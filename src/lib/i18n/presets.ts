import { PROMPT_PRESETS } from "@/lib/ai/prompt-presets";
import { AI_OUTPUT_LANGUAGES, SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import { uiText } from "@/lib/i18n";

function displayPresets<
    T extends Record<string, { name: string; description: string }>,
>(presets: T): T {
    return Object.fromEntries(
        Object.entries(presets).map(([id, preset]) => [
            id,
            {
                ...preset,
                name: uiText(preset.name),
                description: uiText(preset.description),
            },
        ]),
    ) as T;
}

export const UI_TITLE_PRESETS = displayPresets(PROMPT_PRESETS);
export const UI_SUMMARY_PRESETS = displayPresets(SUMMARY_PRESETS);
export const UI_OUTPUT_LANGUAGES = AI_OUTPUT_LANGUAGES.map((language) => ({
    ...language,
    label: uiText(language.label),
}));
