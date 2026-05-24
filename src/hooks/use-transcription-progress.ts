"use client";

import { useEffect, useState } from "react";

/**
 * Polls the recording detail endpoint while a transcription run is in
 * flight and returns the latest `transcription_progress_seconds` value
 * (the floor of the most recent Whisper segment end). Returns `null`
 * when no progress is known yet — either because the worker just
 * started and hasn't streamed a segment, or because the provider
 * doesn't actually stream incremental events.
 *
 * Why polling instead of SSE/websocket: the existing
 * `/api/recordings/[id]` endpoint already returns the column directly
 * (the worker updates the row as segments arrive). Adding SSE would
 * mean a new endpoint, edge-runtime quirks, and proxy buffering
 * concerns — for a progress signal that only needs ~3s freshness,
 * polling is the smaller delta.
 *
 * The hook stops polling the moment `isTranscribing` flips to false
 * so an idle dashboard doesn't keep hitting the API. The 3s cadence
 * matches Whisper's typical segment cadence on this stack
 * (faster-whisper-medium INT8 on a CPU box emits a segment every
 * ~5-15s, so 3s polling is more frequent than needed but cheap).
 */
export function useTranscriptionProgress(
    recordingId: string | null | undefined,
    isTranscribing: boolean,
): { progressSeconds: number | null } {
    const [progressSeconds, setProgressSeconds] = useState<number | null>(null);

    useEffect(() => {
        if (!recordingId || !isTranscribing) {
            setProgressSeconds(null);
            return;
        }

        // Cancel in-flight requests on cleanup so a teardown after
        // `isTranscribing` flips doesn't write progress onto state for
        // a stale recording.
        const controller = new AbortController();

        const poll = async () => {
            try {
                const res = await fetch(`/api/recordings/${recordingId}`, {
                    signal: controller.signal,
                });
                if (!res.ok) return;
                const data = (await res.json()) as {
                    recording?: {
                        transcriptionProgressSeconds?: number | null;
                    };
                };
                const next =
                    data.recording?.transcriptionProgressSeconds ?? null;
                setProgressSeconds(next);
            } catch (err) {
                // AbortError on teardown is expected; swallow.
                if ((err as { name?: string }).name !== "AbortError") {
                    // Other errors are non-fatal — we'll just retry on
                    // the next tick. Logging once per failure would be
                    // too noisy on flaky networks.
                }
            }
        };

        // Kick off an immediate poll so the UI doesn't sit at "—" for
        // a full interval before the first number lands.
        void poll();
        const interval = setInterval(poll, 3000);

        return () => {
            clearInterval(interval);
            controller.abort();
        };
    }, [recordingId, isTranscribing]);

    return { progressSeconds };
}
