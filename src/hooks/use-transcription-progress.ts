"use client";

import { useEffect, useRef, useState } from "react";

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
 *
 * `onCompleted` fires once the polled row reports that the server has
 * cleared `transcribing_started_at` — i.e. another worker (or this
 * same one, in a different tab) finished the transcribe. The parent
 * uses it to refresh its recording list so `transcriptionInProgress`
 * flips off and the panel transitions from "Transcribing… 36%" to
 * the rendered transcript text.
 */
export function useTranscriptionProgress(
    recordingId: string | null | undefined,
    isTranscribing: boolean,
    onCompleted?: () => void,
): { progressSeconds: number | null } {
    const [progressSeconds, setProgressSeconds] = useState<number | null>(null);
    // Stable ref so the effect doesn't re-run every render when the
    // parent passes a fresh inline callback.
    const onCompletedRef = useRef(onCompleted);
    onCompletedRef.current = onCompleted;

    useEffect(() => {
        if (!recordingId || !isTranscribing) {
            setProgressSeconds(null);
            return;
        }

        // Cancel in-flight requests on cleanup so a teardown after
        // `isTranscribing` flips doesn't write progress onto state for
        // a stale recording.
        const controller = new AbortController();
        // We need at least one poll that saw the server still in
        // progress before treating a null `transcribingStartedAt` as
        // "the worker finished" — otherwise a race where the first
        // poll lands AFTER the worker completes (and BEFORE the
        // parent's RSC-baked flag has been refreshed) would mis-fire
        // onCompleted on a recording that hadn't actually been
        // transcribed in this session.
        let observedActive = false;

        const poll = async () => {
            try {
                const res = await fetch(`/api/recordings/${recordingId}`, {
                    signal: controller.signal,
                });
                if (!res.ok) return;
                const data = (await res.json()) as {
                    recording?: {
                        transcribingStartedAt?: string | null;
                        transcriptionProgressSeconds?: number | null;
                    };
                };
                const next =
                    data.recording?.transcriptionProgressSeconds ?? null;
                setProgressSeconds(next);

                const stillActive = Boolean(
                    data.recording?.transcribingStartedAt,
                );
                if (stillActive) {
                    observedActive = true;
                } else if (observedActive) {
                    onCompletedRef.current?.();
                }
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
