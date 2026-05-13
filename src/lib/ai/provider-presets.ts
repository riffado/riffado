/**
 * Shared preset list for the Add/Edit AI provider dialogs.
 *
 * Single source of truth — both dialogs import from here so the list can't
 * drift. `LOCAL_PRESET_NAMES` are presets whose default `baseUrl` points at
 * the user's machine; on hosted (`IS_HOSTED=true`) we hide them from the
 * dropdown because the hosted app process can't reach loopback. The API
 * layer enforces the same rule via `validateAiBaseUrl`.
 *
 * `transcriptionStyle` controls which API surface the transcription worker
 * uses for a given preset:
 *   - "whisper" → OpenAI-compatible `/v1/audio/transcriptions` (multipart).
 *     Whisper, Groq Whisper, Together Whisper, LM Studio / Ollama Whisper.
 *   - "chat"    → `/v1/chat/completions` with an `input_audio` content part
 *     (OpenAI chat-audio spec). Used for providers that expose audio-input
 *     LLMs instead of a dedicated transcription endpoint, like OpenRouter
 *     (Gemini / GPT-audio / Voxtral routed under one API). See issue #122.
 *
 * The default for the freeform "Custom" preset is "whisper" so existing
 * OpenAI-compatible self-host setups keep working unchanged.
 *
 * ── Maintaining `knownTranscriptionModels` ─────────────────────────────
 *
 * For providers that don't expose a structured `input_modalities` field
 * (everyone except OpenRouter today), we hand-curate the list of
 * transcription models so the Add/Edit dialog can render a dropdown
 * instead of forcing users to paste model ids. When a provider ships a
 * new transcription model:
 *
 *   1. Add the model id (exact string the API expects) to the relevant
 *      preset's `knownTranscriptionModels` array.
 *   2. Note it under `### Added` in `CHANGELOG.md` under `[Unreleased]`.
 *
 * No DB migration is needed — `defaultModel` is a free-form `varchar`,
 * and the dialogs render a "Custom…" escape hatch so users on a stale
 * release can still type a new model id by hand.
 */

export type TranscriptionStyle = "whisper" | "chat";

export interface ProviderPreset {
    name: string;
    baseUrl: string;
    placeholder: string;
    defaultModel: string;
    /**
     * Which transcription API surface this preset uses. Defaults to
     * "whisper" if absent (treated as Whisper-compatible).
     */
    transcriptionStyle: TranscriptionStyle;
    /**
     * If true, the UI offers to fetch the live list of audio-capable models
     * from the provider's `/v1/models` endpoint when the user enters an
     * API key. Only OpenRouter exposes per-model `input_modalities` today.
     */
    fetchAudioModels?: boolean;
    /**
     * Hand-curated list of transcription model ids for providers without a
     * structured capability tag. Drives the dropdown in the dialog; users
     * can still pick "Custom…" to type an arbitrary id (escape hatch for
     * new releases that ship before our next OpenPlaud version).
     */
    knownTranscriptionModels?: readonly string[];
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
        // FIX: Together AI's actual model id is prefixed `openai/`. The
        // previous default `whisper-large-v3` (no prefix) silently 404'd
        // on Together accounts. Their docs:
        // https://docs.together.ai/docs/serverless-models#audio-models
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
        // OpenRouter does NOT expose `/v1/audio/transcriptions`. Audio runs
        // through chat-completions with audio-input models (Gemini 2.x/3.x,
        // openai/gpt-audio, mistralai/voxtral, etc.). See issue #122.
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

/**
 * Resolve the transcription style for a stored credential's provider name.
 * Unknown providers (free-form "Custom" name, legacy values) default to
 * "whisper" — every Whisper-compatible OpenAI-like endpoint keeps working.
 */
export function getTranscriptionStyle(
    providerName: string,
): TranscriptionStyle {
    return findPreset(providerName)?.transcriptionStyle ?? "whisper";
}
