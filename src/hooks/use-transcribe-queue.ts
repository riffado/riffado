"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useBrowserTranscription } from "@/hooks/use-browser-transcription";
import type { TranscriptionModel } from "@/types/transcription";

type ActionKind = "transcribing" | "summarizing";

interface Options {
    /** Called after a successful transcribe so the parent can refresh data. */
    onTranscribeComplete: () => void;
}

/**
 * Per-recording action state for transcription and summarization.
 *
 * A standalone "isTranscribing" boolean races when two transcribes run
 * concurrently -- each request's `finally` would flip it back to false
 * while another was still pending. The per-id map below is the source
 * of truth; callers derive `anyTranscribing` / `isCurrentTranscribing`
 * etc. from `inFlightActions`.
 *
 * `markAction` is exposed so future summarize handlers can use the
 * same map without duplicating the Map-update plumbing.
 */
export function useTranscribeQueue({ onTranscribeComplete }: Options) {
    const [inFlightActions, setInFlightActions] = useState<
        Map<string, ActionKind>
    >(new Map());
    const {
        run: runBrowserTranscription,
        status: browserStatus,
        reset: resetBrowserStatus,
    } = useBrowserTranscription();

    const markAction = useCallback((id: string, kind: ActionKind | null) => {
        setInFlightActions((prev) => {
            const next = new Map(prev);
            if (kind === null) next.delete(id);
            else next.set(id, kind);
            return next;
        });
    }, []);

    /**
     * Trigger transcription for a specific recording id. Used by:
     *   - the per-recording "Transcribe" button in TranscriptionPanel
     *     (via a wrapper that targets the currently selected recording
     *     for backwards compatibility), and
     *   - the command palette's per-row "Transcribe X" quick actions,
     *     which need to dispatch against an arbitrary recording without
     *     having to first change the selection.
     */
    const transcribeById = useCallback(
        async (id: string) => {
            markAction(id, "transcribing");
            try {
                const response = await fetch(
                    `/api/recordings/${id}/transcribe`,
                    { method: "POST" },
                );
                if (response.ok) {
                    toast.success("Transcription complete");
                    onTranscribeComplete();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Transcription failed");
                }
            } catch {
                toast.error("Failed to transcribe recording");
            } finally {
                // Per-id clear only -- don't touch any global "is
                // transcribing" flag (there isn't one), so a concurrent
                // transcribe on a different recording keeps its own
                // marker intact.
                markAction(id, null);
            }
        },
        [markAction, onTranscribeComplete],
    );

    /**
     * Transcribe a recording entirely in the browser via Transformers.js
     * (Whisper in WebAssembly) -- no provider key required. The model
     * download + inference run client-side; only the resulting text is
     * sent to the server for storage. Shares the same `inFlightActions`
     * marker as the server path so the UI's disabled/spinner states work
     * uniformly.
     */
    const transcribeInBrowser = useCallback(
        async (id: string, model: TranscriptionModel) => {
            markAction(id, "transcribing");
            try {
                await runBrowserTranscription({ recordingId: id, model });
                toast.success("Transcription complete");
                onTranscribeComplete();
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : "Browser transcription failed",
                );
            } finally {
                resetBrowserStatus();
                markAction(id, null);
            }
        },
        [
            markAction,
            onTranscribeComplete,
            runBrowserTranscription,
            resetBrowserStatus,
        ],
    );

    return {
        inFlightActions,
        markAction,
        transcribeById,
        transcribeInBrowser,
        browserStatus,
    };
}
