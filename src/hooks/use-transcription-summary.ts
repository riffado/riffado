"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    type SummaryPrompts,
    useSummaryPrompts,
} from "@/hooks/use-summary-prompts";
import {
    addSummarizingId,
    bumpContentGeneration,
    contentGenerationFor,
    isSummarizingForView,
    rememberTranscriptionText,
    removeSummarizingId,
    shouldApplyFetchedSummary,
    shouldApplySummaryToView,
} from "@/lib/summary/job-scope";
import { toast } from "@/lib/toast";

export type { SummaryPromptOption } from "@/hooks/use-summary-prompts";

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

/** Why the last summary request for the current recording failed. */
export interface SummaryError {
    /** API error code, e.g. `AI_PROVIDER_NOT_CONFIGURED`, or `NETWORK_ERROR`. */
    code: string;
    message: string;
}

/**
 * Where loading the stored summary stands for the current recording:
 * `loading` while the GET is in flight, `failed` when it couldn't be
 * read (not "there is no summary"), `loaded` once it answered.
 */
export type SummaryLoadStatus = "loading" | "loaded" | "failed";

interface UseTranscriptionSummaryOptions {
    /** Recording id used for `/api/recordings/:id/summary` requests. */
    recordingId: string | null | undefined;
    /**
     * Latest transcription text. When this changes we drop the cached
     * summary (stale relative to the new text) and re-fetch -- the
     * server may have already auto-summarized after a re-transcribe.
     */
    transcriptionText: string | null | undefined;
    /**
     * Prompt list and selection shared with other surfaces (the library
     * row menus). When omitted, the hook loads its own.
     */
    prompts?: SummaryPrompts;
    /** Called after a summary is generated or deleted on the server. */
    onSummaryChange?: () => void;
}

/**
 * Shared summary state for the recording view (`RecordingView`, used by
 * the dashboard detail pane and the standalone recording page).
 *
 * Returns flat state + handlers; callers compose their own JSX.
 * `handleSummarize(preset?)` generates with the given prompt (and makes
 * it the selected one) or the current selection. `summaryError` holds
 * the last failure for the current recording until the next attempt.
 * `summaryLoadStatus` says whether the stored summary is still loading
 * or couldn't be read; `retrySummaryLoad` asks again.
 * `summarizingIds` lists every recording this view is summarizing.
 */
export function useTranscriptionSummary({
    recordingId,
    transcriptionText,
    prompts,
    onSummaryChange,
}: UseTranscriptionSummaryOptions) {
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [summarizingIds, setSummarizingIds] = useState(
        () => new Set<string>(),
    );
    const summarizingIdsRef = useRef(summarizingIds);
    const isSummarizing = isSummarizingForView(recordingId, summarizingIds);
    const [errorState, setErrorState] = useState<
        (SummaryError & { recordingId: string }) | null
    >(null);
    const summaryError: SummaryError | null =
        errorState && errorState.recordingId === recordingId
            ? { code: errorState.code, message: errorState.message }
            : null;
    const [loadState, setLoadState] = useState<{
        recordingId: string | null | undefined;
        status: SummaryLoadStatus;
    }>({ recordingId, status: "loading" });
    const summaryLoadStatus: SummaryLoadStatus =
        loadState.recordingId === recordingId ? loadState.status : "loading";
    const [summaryExpanded, setSummaryExpanded] = useState(true);
    const ownPrompts = useSummaryPrompts({ enabled: !prompts });
    const {
        options: summaryPromptOptions,
        selectedId: summaryPreset,
        select: setSummaryPreset,
    } = prompts ?? ownPrompts;
    const onSummaryChangeRef = useRef(onSummaryChange);
    useEffect(() => {
        onSummaryChangeRef.current = onSummaryChange;
    }, [onSummaryChange]);

    // Re-fetch trigger separate from the URL/id key so callers can
    // bump it imperatively (e.g. right after a re-transcribe finishes,
    // before the new text has propagated through props).
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    const recordingIdRef = useRef(recordingId);
    const fetchGenerationRef = useRef(0);
    const contentGenByIdRef = useRef(new Map<string, number>());
    const lastTextByIdRef = useRef(
        new Map<string, string | null | undefined>(),
    );
    const getAbortRef = useRef<AbortController | null>(null);
    if (recordingId !== recordingIdRef.current) {
        recordingIdRef.current = recordingId;
        setSummaryData(null);
    }

    // Detect when transcription text actually changes -> invalidate
    // the cached summary so the next fetch lands fresh. We compare
    // through a ref because the dashboard variant receives the text
    // via prop (parent-owned), and reading prop-vs-state isn't enough
    // to spot a stale summary.
    const transcriptionTextRef = useRef(transcriptionText);
    if (transcriptionText !== transcriptionTextRef.current) {
        transcriptionTextRef.current = transcriptionText;
        setSummaryFetchKey((k) => k + 1);
        setSummaryData(null);
    }
    if (
        recordingId &&
        rememberTranscriptionText(
            lastTextByIdRef.current,
            recordingId,
            transcriptionText,
        )
    ) {
        bumpContentGeneration(contentGenByIdRef.current, recordingId);
    }

    // Fetch when recording id changes or the re-fetch key bumps.
    // Abort on cleanup is an optimization; apply only if this fetch's
    // generation is still current so a late A GET cannot overwrite a
    // newer A GET (A → B → A) or a just-finished POST.
    // biome-ignore lint/correctness/useExhaustiveDependencies: summaryFetchKey is an intentional re-fetch trigger
    useEffect(() => {
        if (!recordingId) {
            setSummaryData(null);
            return;
        }
        const requestedId = recordingId;
        const generation = ++fetchGenerationRef.current;
        const controller = new AbortController();
        getAbortRef.current = controller;
        const isCurrent = () =>
            shouldApplyFetchedSummary(
                recordingIdRef.current,
                requestedId,
                fetchGenerationRef.current,
                generation,
            );
        setLoadState({ recordingId: requestedId, status: "loading" });
        fetch(`/api/recordings/${requestedId}/summary`, {
            signal: controller.signal,
        })
            .then((res) => {
                if (!res.ok) throw new Error(`Summary GET ${res.status}`);
                return res.json() as Promise<Partial<SummaryData>>;
            })
            .then((data) => {
                if (!isCurrent()) return;
                if (data.summary) {
                    setSummaryData(data as SummaryData);
                } else {
                    setSummaryData(null);
                }
                setLoadState({ recordingId: requestedId, status: "loaded" });
            })
            .catch(() => {
                if (controller.signal.aborted || !isCurrent()) return;
                setLoadState({ recordingId: requestedId, status: "failed" });
            });
        return () => {
            controller.abort();
            if (getAbortRef.current === controller) {
                getAbortRef.current = null;
            }
        };
    }, [recordingId, summaryFetchKey]);

    const handleSummarize = useCallback(
        async (presetOverride?: string) => {
            if (!recordingId) return;
            if (summarizingIdsRef.current.has(recordingId)) return;
            const targetId = recordingId;
            const preset = presetOverride ?? summaryPreset;
            if (presetOverride) setSummaryPreset(presetOverride);
            setErrorState(null);
            const postGeneration = contentGenerationFor(
                contentGenByIdRef.current,
                targetId,
            );
            const postIsCurrent = () =>
                shouldApplyFetchedSummary(
                    recordingIdRef.current,
                    targetId,
                    contentGenerationFor(contentGenByIdRef.current, targetId),
                    postGeneration,
                );
            getAbortRef.current?.abort();
            fetchGenerationRef.current += 1;
            setLoadState({ recordingId: targetId, status: "loaded" });
            summarizingIdsRef.current = addSummarizingId(
                summarizingIdsRef.current,
                targetId,
            );
            setSummarizingIds(summarizingIdsRef.current);
            try {
                const response = await fetch(
                    `/api/recordings/${targetId}/summary`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ preset }),
                    },
                );
                if (response.ok) {
                    const data = (await response.json()) as SummaryData;
                    onSummaryChangeRef.current?.();
                    if (postIsCurrent()) {
                        fetchGenerationRef.current += 1;
                        setSummaryData(data);
                        if (data.promptFallback) {
                            toast.warning(
                                "That summary style no longer exists, so your default style was used",
                            );
                        } else {
                            toast.success("Summary generated");
                        }
                    }
                } else {
                    const error = await response.json().catch(() => ({}));
                    if (postIsCurrent()) {
                        const message =
                            error.error || "Summary generation failed";
                        setErrorState({
                            recordingId: targetId,
                            code:
                                typeof error.code === "string"
                                    ? error.code
                                    : "UNKNOWN_ERROR",
                            message,
                        });
                        toast.error(message);
                    }
                }
            } catch {
                if (postIsCurrent()) {
                    setErrorState({
                        recordingId: targetId,
                        code: "NETWORK_ERROR",
                        message: "Couldn't reach the server.",
                    });
                    toast.error("Failed to generate summary");
                }
            } finally {
                summarizingIdsRef.current = removeSummarizingId(
                    summarizingIdsRef.current,
                    targetId,
                );
                setSummarizingIds(summarizingIdsRef.current);
            }
        },
        [recordingId, summaryPreset, setSummaryPreset],
    );

    const handleDeleteSummary = useCallback(async () => {
        if (!recordingId) return;
        const targetId = recordingId;
        // Optimistic delete -- the summary disappears immediately and
        // only comes back if the server rejects the request.
        const previous = summaryData;
        setSummaryData(null);
        // A summary GET still in flight (the recording was just opened)
        // must not bring the deleted summary back.
        getAbortRef.current?.abort();
        fetchGenerationRef.current += 1;
        setLoadState({ recordingId: targetId, status: "loaded" });
        const deleteIsCurrent = () =>
            shouldApplySummaryToView(recordingIdRef.current, targetId);

        try {
            const response = await fetch(
                `/api/recordings/${targetId}/summary`,
                { method: "DELETE" },
            );
            if (response.ok) {
                onSummaryChangeRef.current?.();
                if (deleteIsCurrent()) {
                    toast.success("Summary deleted");
                }
            } else {
                if (deleteIsCurrent()) {
                    setSummaryData(previous);
                    toast.error("Failed to delete summary");
                }
            }
        } catch {
            if (deleteIsCurrent()) {
                setSummaryData(previous);
                toast.error("Failed to delete summary");
            }
        }
    }, [recordingId, summaryData]);

    /**
     * Imperative re-fetch trigger. Use after a re-transcribe call
     * where the server may already have re-summarized -- bumping the
     * key forces a GET without changing recordingId.
     */
    const refetchSummary = useCallback(() => {
        const id = recordingIdRef.current;
        if (id) {
            bumpContentGeneration(contentGenByIdRef.current, id);
        }
        setSummaryData(null);
        setSummaryFetchKey((k) => k + 1);
    }, []);

    /** Asks for the stored summary again after a failed load. */
    const retrySummaryLoad = useCallback(() => {
        setSummaryFetchKey((k) => k + 1);
    }, []);

    return {
        summaryData,
        summaryLoadStatus,
        retrySummaryLoad,
        isSummarizing,
        summarizingIds,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        summaryPromptOptions,
        summaryError,
        handleSummarize,
        handleDeleteSummary,
        refetchSummary,
    };
}
