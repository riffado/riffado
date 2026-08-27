"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
    getAllSummaryPrompts,
    getDefaultSummaryPromptConfig,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import {
    getInFlightSummary,
    hasInFlightSummary,
    isSummarizingForView,
    nextSummariesById,
    type SummaryJobResult,
    subscribeInFlightSummaries,
    summaryForView,
    trackInFlightSummary,
} from "@/lib/summary/job-scope";

export interface SummaryPromptOption {
    id: string;
    name: string;
    isPreset: boolean;
}

export interface SummaryData {
    summary: string | null;
    keyPoints: string[] | null;
    actionItems: string[] | null;
    provider?: string;
    model?: string;
    /** Prompt id actually used server-side. Only present on POST responses. */
    promptId?: string;
    /**
     * True when the requested prompt id couldn't be resolved (e.g. a
     * custom prompt deleted from another tab) and the server fell back
     * to the default prompt instead. Only present on POST responses.
     */
    promptFallback?: boolean;
}

interface UseTranscriptionSummaryOptions {
    /** Recording id used for `/api/recordings/:id/summary` requests. */
    recordingId: string | null | undefined;
    /**
     * Latest transcription text. When this changes we drop the cached
     * summary (stale relative to the new text) and re-fetch -- the
     * server may have already auto-summarized after a re-transcribe.
     */
    transcriptionText: string | null | undefined;
}

/**
 * Shared summary state for the transcription views. Both the dashboard
 * (`TranscriptionPanel`) and the recording detail page
 * (`recordings/TranscriptionSection`) use the same endpoints with the
 * same expand/preset/optimistic-delete UX -- only the visual chrome
 * differs.
 *
 * Spinner and result are keyed by recording id so a job started on A
 * cannot paint onto B when the panel stays mounted across selection.
 *
 * Returns flat state + handlers; callers compose their own JSX so the
 * dashboard's shadcn `Card`/`Button` look and the recording page's
 * `Panel`/`MetalButton` look stay distinct on purpose.
 */
export function useTranscriptionSummary({
    recordingId,
    transcriptionText,
}: UseTranscriptionSummaryOptions) {
    const [summariesById, setSummariesById] = useState<
        Map<string, SummaryData | null>
    >(() => new Map());
    const summaryData = summaryForView(summariesById, recordingId);
    const isSummarizing = useSyncExternalStore(
        subscribeInFlightSummaries,
        () => isSummarizingForView(recordingId),
        () => false,
    );
    const [summaryExpanded, setSummaryExpanded] = useState(true);
    const [summaryPreset, setSummaryPresetState] = useState("general");
    // Set the moment the caller (the per-recording dropdown) makes an
    // explicit choice. Guards the settings-fetch effect below from
    // clobbering that choice if the fetch resolves afterwards -- without
    // this, picking a prompt right after the page loads could get silently
    // reverted back to the saved default a moment later.
    const userSelectedPresetRef = useRef(false);
    const setSummaryPreset = useCallback((preset: string) => {
        userSelectedPresetRef.current = true;
        setSummaryPresetState(preset);
    }, []);
    const [summaryPromptOptions, setSummaryPromptOptions] = useState<
        SummaryPromptOption[]
    >(() =>
        getAllSummaryPrompts(getDefaultSummaryPromptConfig()).map((p) => ({
            id: p.id,
            name: p.name,
            isPreset: p.isPreset,
        })),
    );

    // Re-fetch trigger separate from the URL/id key so callers can
    // bump it imperatively (e.g. right after a re-transcribe finishes,
    // before the new text has propagated through props).
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    // Load the user's saved default prompt + custom prompts once so the
    // per-recording dropdown initializes to the actual default (not a
    // hardcoded "general") and lists custom prompts alongside presets.
    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/settings/user", { signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const config = data?.summaryPrompt as
                    | SummaryPromptConfiguration
                    | null
                    | undefined;
                if (!config) return;
                if (config.selectedPrompt && !userSelectedPresetRef.current) {
                    setSummaryPresetState(config.selectedPrompt);
                }
                setSummaryPromptOptions(
                    getAllSummaryPrompts(config).map((p) => ({
                        id: p.id,
                        name: p.name,
                        isPreset: p.isPreset,
                    })),
                );
            })
            .catch(() => {});
        return () => controller.abort();
    }, []);

    // Detect when transcription text actually changes -> invalidate
    // the cached summary so the next fetch lands fresh. We compare
    // through a ref because the dashboard variant receives the text
    // via prop (parent-owned), and reading prop-vs-state isn't enough
    // to spot a stale summary. Only the same recording is cleared;
    // switching recordings must not wipe another id's cached result.
    const recordingIdRef = useRef(recordingId);
    const transcriptionTextRef = useRef(transcriptionText);
    const prevRecordingId = recordingIdRef.current;
    recordingIdRef.current = recordingId;
    if (transcriptionText !== transcriptionTextRef.current) {
        transcriptionTextRef.current = transcriptionText;
        if (recordingId && recordingId === prevRecordingId) {
            setSummaryFetchKey((k) => k + 1);
            setSummariesById((prev) => {
                if (!prev.has(recordingId)) return prev;
                const next = new Map(prev);
                next.delete(recordingId);
                return next;
            });
        }
    }

    // Fetch when recording id changes or the re-fetch key bumps.
    // Writes land on the requested id only -- a late GET for A must
    // not populate B's slot, and an in-flight POST for that id wins
    // over an empty GET.
    // biome-ignore lint/correctness/useExhaustiveDependencies: summaryFetchKey is an intentional re-fetch trigger
    useEffect(() => {
        if (!recordingId) {
            return;
        }
        const requestedId = recordingId;
        const controller = new AbortController();
        fetch(`/api/recordings/${requestedId}/summary`, {
            signal: controller.signal,
        })
            .then((res) => res.json())
            .then((data) => {
                if (hasInFlightSummary(requestedId)) return;
                setSummariesById((prev) =>
                    nextSummariesById(
                        prev,
                        requestedId,
                        data.summary ? data : null,
                    ),
                );
            })
            .catch(() => {});
        return () => controller.abort();
    }, [recordingId, summaryFetchKey]);

    // A remounted hook (recording page) or a return to this id must
    // adopt an already-running job so the spinner stays up and the
    // result writes into this id's slot when it lands.
    useEffect(() => {
        if (!recordingId || !isSummarizing) return;
        const requestedId = recordingId;
        const job = getInFlightSummary(requestedId);
        if (!job) return;
        let cancelled = false;
        job.then((result) => {
            if (cancelled) return;
            const typed = result as SummaryJobResult<SummaryData>;
            if (typed.status === "ok") {
                setSummariesById((prev) =>
                    nextSummariesById(prev, requestedId, typed.data),
                );
            }
        });
        return () => {
            cancelled = true;
        };
    }, [recordingId, isSummarizing]);

    const handleSummarize = useCallback(async () => {
        if (!recordingId) return;
        const targetId = recordingId;
        const result = await trackInFlightSummary(targetId, async () => {
            try {
                const response = await fetch(
                    `/api/recordings/${targetId}/summary`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ preset: summaryPreset }),
                    },
                );
                if (response.ok) {
                    const data = (await response.json()) as SummaryData;
                    return { status: "ok" as const, data };
                }
                const error = await response.json().catch(() => ({}));
                return {
                    status: "error" as const,
                    message: error.error || "Summary generation failed",
                };
            } catch {
                return {
                    status: "error" as const,
                    message: "Failed to generate summary",
                };
            }
        });
        switch (result.status) {
            case "ok":
                setSummariesById((prev) =>
                    nextSummariesById(prev, targetId, result.data),
                );
                if (result.data.promptFallback) {
                    toast.warning(
                        "Selected summary prompt is no longer available -- used your default prompt instead.",
                    );
                } else {
                    toast.success("Summary generated");
                }
                break;
            case "error":
                toast.error(result.message);
                break;
            default: {
                const _exhaustive: never = result;
                return _exhaustive;
            }
        }
    }, [recordingId, summaryPreset]);

    const handleDeleteSummary = useCallback(async () => {
        if (!recordingId) return;
        const targetId = recordingId;
        const previous = summaryForView(summariesById, targetId);
        setSummariesById((prev) => nextSummariesById(prev, targetId, null));

        try {
            const response = await fetch(
                `/api/recordings/${targetId}/summary`,
                { method: "DELETE" },
            );
            if (response.ok) {
                toast.success("Summary deleted");
            } else {
                setSummariesById((prev) =>
                    nextSummariesById(prev, targetId, previous),
                );
                toast.error("Failed to delete summary");
            }
        } catch {
            setSummariesById((prev) =>
                nextSummariesById(prev, targetId, previous),
            );
            toast.error("Failed to delete summary");
        }
    }, [recordingId, summariesById]);

    /**
     * Imperative re-fetch trigger. Use after a re-transcribe call
     * where the server may already have re-summarized -- bumping the
     * key forces a GET without changing recordingId.
     */
    const refetchSummary = useCallback(() => {
        if (recordingId) {
            setSummariesById((prev) => {
                if (!prev.has(recordingId)) return prev;
                const next = new Map(prev);
                next.delete(recordingId);
                return next;
            });
        }
        setSummaryFetchKey((k) => k + 1);
    }, [recordingId]);

    return {
        summaryData,
        isSummarizing,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        summaryPromptOptions,
        handleSummarize,
        handleDeleteSummary,
        refetchSummary,
    };
}
