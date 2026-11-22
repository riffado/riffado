/** One transcript of a recording, per source (Plaud, the user's provider, an edit). */
export interface RecordingTranscript {
    /** `riffado` (the user's provider), `plaud` (imported) or `mixed` (edited). */
    source: string;
    text: string;
    /** ISO 639-1 code when the provider detected one. */
    language?: string;
    /** Stored provider name, e.g. `OpenAI`, `Ollama`, `mynah`, `browser`. */
    provider?: string;
    /** `server` or `browser`. */
    transcriptionType?: string;
}

/** Whether an AI provider that can write summaries is set up. */
export type SummaryProviderState = "unknown" | "ready" | "missing";

/** Player preferences forwarded from user settings. */
export interface PlayerPreferences {
    initialPlaybackSpeed?: number;
    initialVolume?: number;
    initialAutoPlayNext?: boolean;
    scrubberStyle?: "waveform" | "slider";
}
