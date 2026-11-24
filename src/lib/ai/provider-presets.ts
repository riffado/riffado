import { CHATGPT_BASE_URL, CHATGPT_PROVIDER_NAME } from "./chatgpt/constants";

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
     * Whether this provider can transcribe audio. Defaults to `true` when
     * omitted -- only enhancement-only providers (ChatGPT plan usage, which
     * covers text requests only) set this to `false`.
     */
    supportsTranscription?: boolean;
    /**
     * Connected through "Sign in with ChatGPT" instead of an API key. The
     * provider dialogs render the sign-in flow instead of key/URL fields.
     */
    usesChatGptSignIn?: boolean;
    /** Only offered on self-hosted instances. */
    selfHostOnly?: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
    {
        name: "OpenAI",
        baseUrl: "",
        placeholder: "sk-...",
        defaultModel: "whisper-1",
        transcriptionStyle: "whisper",
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
        // ChatGPT plan usage via "Sign in with ChatGPT". OpenAI allows it
        // for open-source, locally hosted apps; remotely hosted apps need
        // OpenAI's approval, so it's self-host only. Text-only: summaries
        // and titles, never transcription.
        name: CHATGPT_PROVIDER_NAME,
        baseUrl: CHATGPT_BASE_URL,
        placeholder: "",
        defaultModel: "",
        transcriptionStyle: "whisper",
        supportsTranscription: false,
        usesChatGptSignIn: true,
        selfHostOnly: true,
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
    return PROVIDER_PRESETS.filter(
        (p) => !LOCAL_PRESET_NAMES.has(p.name) && !p.selfHostOnly,
    );
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
 * Whether a provider can transcribe audio. Unknown/custom provider names
 * default to `true`.
 */
export function supportsTranscription(providerName: string): boolean {
    return findPreset(providerName)?.supportsTranscription ?? true;
}

/** Whether a provider is connected via "Sign in with ChatGPT". */
export function usesChatGptSignIn(providerName: string): boolean {
    return findPreset(providerName)?.usesChatGptSignIn ?? false;
}
