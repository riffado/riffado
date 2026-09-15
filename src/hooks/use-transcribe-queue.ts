"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";

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
                    toast.success(uiText("Transcription complete"));
                    onTranscribeComplete();
                } else {
                    const error = await response.json();
                    toast.error(
                        uiError(
                            error.error || uiText("Transcription failed"),
                            error.code,
                        ),
                    );
                }
            } catch {
                toast.error(uiText("Failed to transcribe recording"));
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

    return {
        inFlightActions,
        markAction,
        transcribeById,
    };
}
