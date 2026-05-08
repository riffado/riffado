/**
 * Shared preset list for the Add/Edit AI provider dialogs.
 *
 * Single source of truth — both dialogs import from here so the list can't
 * drift. `LOCAL_PRESET_NAMES` are presets whose default `baseUrl` points at
 * the user's machine; on hosted (`IS_HOSTED=true`) we hide them from the
 * dropdown because the hosted app process can't reach loopback. The API
 * layer enforces the same rule via `validateAiBaseUrl`.
 */

export interface ProviderPreset {
    name: string;
    baseUrl: string;
    placeholder: string;
    defaultModel: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
    {
        name: "OpenAI",
        baseUrl: "",
        placeholder: "sk-...",
        defaultModel: "whisper-1",
    },
    {
        name: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        placeholder: "gsk_...",
        defaultModel: "whisper-large-v3-turbo",
    },
    {
        name: "Together AI",
        baseUrl: "https://api.together.xyz/v1",
        placeholder: "...",
        defaultModel: "whisper-large-v3",
    },
    {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        placeholder: "sk-or-...",
        defaultModel: "whisper-1",
    },
    {
        name: "LM Studio",
        baseUrl: "http://localhost:1234/v1",
        placeholder: "lm-studio",
        defaultModel: "",
    },
    {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        placeholder: "ollama",
        defaultModel: "",
    },
    {
        name: "Custom",
        baseUrl: "",
        placeholder: "Your API key",
        defaultModel: "",
    },
] as const;

export const LOCAL_PRESET_NAMES: ReadonlySet<string> = new Set([
    "LM Studio",
    "Ollama",
]);

/**
 * Presets to render in the dropdown for a given deployment mode.
 * On hosted we omit local-only presets; on self-host we show everything.
 */
export function getVisiblePresets({
    isHosted,
}: {
    isHosted: boolean;
}): readonly ProviderPreset[] {
    if (!isHosted) return PROVIDER_PRESETS;
    return PROVIDER_PRESETS.filter((p) => !LOCAL_PRESET_NAMES.has(p.name));
}

export function findPreset(name: string): ProviderPreset | undefined {
    return PROVIDER_PRESETS.find((p) => p.name === name);
}

export function isLocalPreset(name: string): boolean {
    return LOCAL_PRESET_NAMES.has(name);
}
