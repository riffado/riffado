import type { InferSelectModel } from "drizzle-orm";
import type { recordings } from "@/db/schema";

export type RecordingQueryResult = Pick<
    InferSelectModel<typeof recordings>,
    "id" | "filename" | "duration" | "startTime" | "filesize" | "deviceSn"
> & {
    /**
     * Decrypted free-text context the caller (or the user via the
     * GUI editor) attached to this recording. Plain-string here
     * because the encryption boundary lives in the loader; the
     * dashboard treats it as opaque text. Null when none was set.
     */
    context?: string | null;
};

export type Recording = Omit<RecordingQueryResult, "startTime"> & {
    startTime: string;
    /**
     * Status flags surfaced into list rows so the user can scan which
     * recordings have already been processed. Both default to `false`
     * for backward compatibility with callers that don't compute them.
     */
    hasTranscript?: boolean;
    hasSummary?: boolean;
    /**
     * Coarse normalized amplitude peaks ([0, 1]) for waveform rendering.
     * Decoded client-side on first listen and cached server-side. Null
     * when never decoded; an empty array would be invalid (treat as null).
     */
    waveformPeaks?: number[] | null;
    /**
     * True while a transcribe worker still holds an active claim on
     * the recording (i.e. `transcribing_started_at` is within the 3h
     * stale window). Lets the dashboard show "Transcribing… 36%" on
     * reload or in a second tab — previously the panel only knew
     * about transcribes started in the current React tree.
     */
    transcriptionInProgress?: boolean;
    /**
     * Latest segment-end-seconds reported by the streaming provider
     * (floor of Whisper's latest segment `end`). Null when no run is
     * in progress or the provider didn't stream incremental events.
     * Used as a first-render value before the polling hook lands.
     */
    transcriptionProgressSeconds?: number | null;
};

// Helper to serialize a recording query result. Optional fields let
// callers that don't compute flags (sync worker, v1 API) skip them.
export function serializeRecording(
    recording: RecordingQueryResult,
    flags?: {
        hasTranscript?: boolean;
        hasSummary?: boolean;
        waveformPeaks?: number[] | null;
        transcriptionInProgress?: boolean;
        transcriptionProgressSeconds?: number | null;
    },
): Recording {
    return {
        ...recording,
        startTime: recording.startTime.toISOString(),
        hasTranscript: flags?.hasTranscript ?? false,
        hasSummary: flags?.hasSummary ?? false,
        // Empty arrays would be invalid per the field contract ("null
        // when never decoded"); collapse them to null at the
        // serialization boundary so consumers never have to special-case
        // `peaks.length === 0`.
        waveformPeaks: flags?.waveformPeaks?.length
            ? flags.waveformPeaks
            : null,
        transcriptionInProgress: flags?.transcriptionInProgress ?? false,
        transcriptionProgressSeconds:
            flags?.transcriptionProgressSeconds ?? null,
    };
}
