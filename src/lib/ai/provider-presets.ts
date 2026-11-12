export type TranscriptionStyle = "whisper" | "chat" | "gemini" | "elevenlabs";

export interface ProviderPreset {
    name: string;
    baseUrl: string;
    placeholder: string;
    defaultModel: string;
    transcriptionStyle: TranscriptionStyle;
    fetchAudioModels?: boolean;
    knownTranscriptionModels?: readonly string[];
    /**
     * Whether this provider can be used for AI enhancements (summaries,
     * titles) via `chat.completions`. Defaults to `true` when omitted --
     * only transcription-only providers (e.g. ElevenLabs Scribe) set this
     * to `false`.
     */
    supportsEnhancement?: boolean;
    /**
     * Chat model for enhancements when the credential's model is a
     * transcription id (or unset). Needed wherever the provider serves
     * neither `defaultModel` nor `gpt-4o-mini` on `chat.completions` --
     * Groq, for one, rejects both. `gpt-4o-mini` is the fallback when a
     * provider leaves this unset.
     */
    enhancementModel?: string;
    /**
     * OpenAI-compatible endpoint for enhancements when the credential has no
     * base URL. Needed where `baseUrl` is empty because transcription uses a
     * native client: without it, `chat.completions` would go to OpenAI with
     * the provider's key.
     */
    enhancementBaseUrl?: string;
    /**
     * Model ids the provider has shut down. Enhancements replace them with
     * `enhancementModel`. Older credentials still store them, because
     * `defaultModel` used to prefill them.
     */
    retiredModels?: readonly string[];
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
    {
        name: "OpenAI",
        baseUrl: "",
        placeholder: "sk-...",
        defaultModel: "whisper-1",
        transcriptionStyle: "whisper",
        enhancementModel: "gpt-4o-mini",
        knownTranscriptionModels: [
            "whisper-1",
            "gpt-4o-transcribe",
            "gpt-4o-mini-transcribe",
            "gpt-4o-transcribe-diarize",
        ],
    },
    {
        name: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        placeholder: "gsk_...",
        defaultModel: "whisper-large-v3-turbo",
        transcriptionStyle: "whisper",
        // Groq serves neither llama-3.x nor gpt-4o-mini on chat.completions
        // any more; qwen3.8-27b returns plain text, gpt-oss-20b spends its
        // budget on reasoning and yields an empty completion.
        enhancementModel: "qwen/qwen3.8-27b",
        knownTranscriptionModels: [
            "whisper-large-v3-turbo",
            "whisper-large-v3",
        ],
    },
    {
        name: "Together AI",
        baseUrl: "https://api.together.xyz/v1",
        placeholder: "...",
        defaultModel: "openai/whisper-large-v3",
        transcriptionStyle: "whisper",
        enhancementModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        knownTranscriptionModels: [
            "openai/whisper-large-v3",
            "nvidia/parakeet-tdt-0.6b-v3",
        ],
    },
    {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        placeholder: "sk-or-...",
        defaultModel: "google/gemini-2.5-flash-lite",
        transcriptionStyle: "chat",
        enhancementModel: "google/gemini-2.5-flash-lite",
        fetchAudioModels: true,
    },
    {
        name: "LM Studio",
        baseUrl: "http://localhost:1234/v1",
        placeholder: "lm-studio",
        defaultModel: "",
        transcriptionStyle: "whisper",
    },
    {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        placeholder: "ollama",
        defaultModel: "",
        transcriptionStyle: "whisper",
    },
    {
        name: "Google Gemini",
        baseUrl: "",
        placeholder: "AIza...",
        defaultModel: "gemini-2.0-flash",
        transcriptionStyle: "gemini",
        // Transcription uses the native SDK, so `baseUrl` stays empty; titles
        // and summaries go through Google's OpenAI-compatible endpoint.
        enhancementBaseUrl:
            "https://generativelanguage.googleapis.com/v1beta/openai",
        // Google shut down gemini-2.0-flash on 2026-06-01. 2.5 Flash-Lite has
        // no announced shutdown date.
        enhancementModel: "gemini-2.5-flash-lite",
        retiredModels: [
            "gemini-2.0-flash",
            "gemini-2.0-flash-001",
            "gemini-2.0-flash-lite",
            "gemini-2.0-flash-lite-001",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ],
        knownTranscriptionModels: [
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ],
    },
    {
        name: "ElevenLabs",
        baseUrl: "https://api.elevenlabs.io/v1",
        placeholder: "sk_...",
        defaultModel: "scribe_v2",
        transcriptionStyle: "elevenlabs",
        knownTranscriptionModels: ["scribe_v2", "scribe_v1"],
        supportsEnhancement: false,
    },
    {
        name: "Custom",
        baseUrl: "",
        placeholder: "Your API key",
        defaultModel: "",
        transcriptionStyle: "whisper",
    },
] as const;

export const LOCAL_PRESET_NAMES: ReadonlySet<string> = new Set([
    "LM Studio",
    "Ollama",
]);

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

/**
 * Case-insensitive preset lookup for enhancements only: older rows can store
 * names such as `groq` or `elevenlabs`. Transcription keeps the exact match
 * in `findPreset`. A non-string name (bad API input) matches nothing.
 */
function findPresetLoose(name: unknown): ProviderPreset | undefined {
    if (typeof name !== "string") return undefined;
    const wanted = name.trim().toLowerCase();
    return PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === wanted);
}

export function isLocalPreset(name: string): boolean {
    return LOCAL_PRESET_NAMES.has(name);
}

export function getTranscriptionStyle(
    providerName: string,
): TranscriptionStyle {
    return findPreset(providerName)?.transcriptionStyle ?? "whisper";
}

/**
 * Whether a provider can run AI enhancements (summaries, titles) via
 * `chat.completions`. Unknown/custom provider names default to `true`.
 */
export function supportsEnhancement(providerName: string): boolean {
    return findPresetLoose(providerName)?.supportsEnhancement ?? true;
}

const TRANSCRIPTION_MODEL_PATTERN = /whisper|parakeet|scribe|transcribe/i;

// Substrings the summary path matched before preset lookup existed. They
// still catch other domains and gateway URLs (for example a Cloudflare AI
// Gateway path ending in `/groq`).
const URL_KEYWORDS: readonly (readonly [string, string])[] = [
    ["groq", "Groq"],
    ["together", "Together AI"],
    ["openrouter", "OpenRouter"],
];

function hostOf(url: string | null | undefined): string | undefined {
    if (typeof url !== "string" || !url.trim()) return undefined;
    try {
        return new URL(url.trim()).host;
    } catch {
        return undefined;
    }
}

/**
 * Preset for a credential with a base URL: the requests go there. Order:
 * 1. A preset whose endpoint host equals the URL host. The edit dialog can
 *    point a credential at another service and keep the old provider name,
 *    so a known endpoint wins over the name.
 * 2. The provider name. An unknown endpoint, such as a proxy, keeps the
 *    named provider's defaults. `Custom` has no endpoint and no model, so it
 *    is skipped here.
 * 3. A service keyword in the URL, as the summary path matched before.
 */
function resolvePreset(
    providerName: string,
    baseUrl?: string | null,
): ProviderPreset | undefined {
    const host = hostOf(baseUrl);
    if (host) {
        const byHost = PROVIDER_PRESETS.find(
            (preset) =>
                hostOf(preset.baseUrl) === host ||
                hostOf(preset.enhancementBaseUrl) === host,
        );
        if (byHost) return byHost;
    }
    const byName = findPresetLoose(providerName);
    if (byName && (byName.baseUrl || byName.defaultModel)) return byName;
    if (typeof baseUrl !== "string") return undefined;
    const url = baseUrl.toLowerCase();
    const keyword = URL_KEYWORDS.find(([word]) => url.includes(word));
    return keyword ? findPreset(keyword[1]) : undefined;
}

/**
 * Model to call `chat.completions` with for summaries and titles. A stored
 * credential model is often a transcription id (Whisper, Parakeet, Scribe,
 * `gpt-4o-transcribe`) or unset, none of which any provider accepts for chat;
 * in that case use the provider's chat model. Dual-use models such as
 * Gemini's chat models are listed as known transcription models but work on
 * `chat.completions`, so only the id patterns above are swapped, plus ids
 * the provider has shut down (`retiredModels`). The fallback is never an id
 * that matches the transcription pattern.
 */
export function getEnhancementModel(
    providerName: string,
    model: string | null | undefined,
    baseUrl?: string | null,
): string {
    const preset = resolvePreset(providerName, baseUrl);
    const stored = typeof model === "string" ? model.trim() : "";
    if (
        stored &&
        !TRANSCRIPTION_MODEL_PATTERN.test(stored) &&
        !preset?.retiredModels?.includes(stored)
    ) {
        return stored;
    }
    const fallback = preset?.enhancementModel || preset?.defaultModel;
    return fallback && !TRANSCRIPTION_MODEL_PATTERN.test(fallback)
        ? fallback
        : "gpt-4o-mini";
}

/**
 * Base URL for the enhancement `chat.completions` client: the credential's
 * own URL, else the named preset's `enhancementBaseUrl`, else `undefined`
 * (the OpenAI SDK default). With no URL, the stored provider name is the
 * only signal, so a credential whose name no longer matches its service
 * (see `resolvePreset`) is not corrected here.
 */
export function getEnhancementBaseUrl(
    providerName: string,
    baseUrl: string | null | undefined,
): string | undefined {
    const own = typeof baseUrl === "string" ? baseUrl.trim() : "";
    if (own) return own;
    return findPresetLoose(providerName)?.enhancementBaseUrl || undefined;
}
