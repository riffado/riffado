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
    return findPreset(providerName)?.supportsEnhancement ?? true;
}

/**
 * Preset for a credential: by name (case-insensitive, since older rows store
 * provider names verbatim), else by the endpoint a `Custom` credential points
 * at, so a known service configured under `Custom` keeps its chat model.
 */
function resolvePreset(
    providerName: string,
    baseUrl?: string | null,
): ProviderPreset | undefined {
    const name = providerName.trim().toLowerCase();
    const byName = PROVIDER_PRESETS.find(
        (preset) => preset.name.toLowerCase() === name,
    );
    // `Custom` has no endpoint and no default model: resolve those by URL so a
    // known service configured under Custom keeps its chat model.
    if (byName && (byName.baseUrl || byName.defaultModel)) return byName;
    if (!baseUrl) return undefined;
    try {
        const { host } = new URL(baseUrl);
        return PROVIDER_PRESETS.find((preset) => {
            if (!preset.baseUrl) return false;
            try {
                return new URL(preset.baseUrl).host === host;
            } catch {
                return false;
            }
        });
    } catch {
        return undefined;
    }
}

/**
 * Model to call `chat.completions` with for summaries and titles. A stored
 * credential model is often a transcription id (Whisper, Parakeet, Scribe,
 * `gpt-4o-transcribe`) or unset, none of which any provider accepts for chat;
 * in that case use the provider's chat model. Dual-use models such as
 * Gemini's chat models are listed as known transcription models but work on
 * `chat.completions`, so only the id patterns above are swapped.
 */
export function getEnhancementModel(
    providerName: string,
    model: string | null | undefined,
    baseUrl?: string | null,
): string {
    const preset = resolvePreset(providerName, baseUrl);
    const isTranscriptionModel =
        !model || /whisper|parakeet|scribe|transcribe/i.test(model);
    if (!isTranscriptionModel) return model;
    return preset?.enhancementModel || preset?.defaultModel || "gpt-4o-mini";
}
