import type { InferSelectModel } from "drizzle-orm";
import type { recordings } from "@/db/schema";

export type RecordingQueryResult = Pick<
    InferSelectModel<typeof recordings>,
    | "id"
    | "filename"
    | "duration"
    | "startTime"
    | "filesize"
    | "deviceSn"
    | "filetagId"
>;

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
};

// Helper to serialize a recording query result. Optional fields let
// callers that don't compute flags (sync worker, v1 API) skip them.
export function serializeRecording(
    recording: RecordingQueryResult,
    flags?: {
        hasTranscript?: boolean;
        hasSummary?: boolean;
        waveformPeaks?: number[] | null;
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
    };
}
