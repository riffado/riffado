"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { transcribeInBrowser } from "@/lib/transcription/browser-transcriber";
import type { TranscriptionModel } from "@/types/transcription";

/** Step of an in-browser transcription, or `idle` when none is running. */
export type BrowserTranscriptionPhase =
    | "idle"
    | "downloading-audio"
    | "decoding-audio"
    | "loading-model"
    | "transcribing";

const PHASE_LABEL: Record<
    Exclude<BrowserTranscriptionPhase, "idle">,
    string
> = {
    "downloading-audio": "Downloading audio…",
    "decoding-audio": "Decoding audio…",
    "loading-model": "Loading Whisper (one-time download)…",
    transcribing: "Transcribing in your browser…",
};

/** Plain-language label for a running phase. */
export function browserPhaseLabel(
    phase: Exclude<BrowserTranscriptionPhase, "idle">,
): string {
    return PHASE_LABEL[phase];
}

interface UseBrowserTranscriptionOptions {
    /** Called after a successful save so the parent can refresh data. */
    onComplete: () => void;
    /** Defaults to `"whisper-base"` (~75MB download, multilingual). */
    model?: TranscriptionModel;
}

/** One in-browser transcription runner, shared by every surface. */
export interface BrowserTranscription {
    /** Recording a run is going for, or null. One run at a time. */
    runningId: string | null;
    /** True while any browser transcription runs. */
    isRunning: boolean;
    /** Step of the run for `recordingId`, or `idle` when none runs for it. */
    phaseFor: (recordingId: string) => BrowserTranscriptionPhase;
    /** Starts a run for `recordingId`; a no-op while another runs. */
    start: (recordingId: string) => Promise<void>;
}

/**
 * Run Whisper in the browser via Transformers.js, then POST the result
 * to `/api/recordings/[id]/transcription/from-browser`. No API key
 * needed; audio never leaves the user's machine.
 *
 * The Whisper model is fetched from the Hugging Face CDN on first use
 * (~75MB for whisper-base) and cached by the browser. Owned once per
 * page (the dashboard shares it between the reader and the library row
 * menus), so a run started anywhere shows everywhere.
 */
export function useBrowserTranscription({
    onComplete,
    model = "whisper-base",
}: UseBrowserTranscriptionOptions): BrowserTranscription {
    const [run, setRun] = useState<{
        recordingId: string;
        phase: Exclude<BrowserTranscriptionPhase, "idle">;
    } | null>(null);
    const runningRef = useRef(false);
    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    const start = useCallback(
        async (id: string) => {
            if (runningRef.current) return;
            runningRef.current = true;
            const setPhase = (
                phase: Exclude<BrowserTranscriptionPhase, "idle">,
            ) => setRun({ recordingId: id, phase });
            try {
                setPhase("downloading-audio");
                const audioRes = await fetch(`/api/recordings/${id}/audio`);
                if (!audioRes.ok) {
                    throw new Error(
                        `Failed to fetch audio (${audioRes.status})`,
                    );
                }
                const blob = await audioRes.blob();
                const file = new File([blob], `recording-${id}`, {
                    type: blob.type || "audio/mpeg",
                });

                setPhase("decoding-audio");
                const result = await transcribeInBrowser(
                    file,
                    model,
                    (status) => {
                        if (status === "decoding-audio")
                            setPhase("decoding-audio");
                        if (status === "loading-model")
                            setPhase("loading-model");
                        if (status === "transcribing") setPhase("transcribing");
                    },
                );

                const postRes = await fetch(
                    `/api/recordings/${id}/transcription/from-browser`,
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            text: result.text,
                            detectedLanguage: result.detectedLanguage,
                            model,
                        }),
                    },
                );
                if (!postRes.ok) {
                    const err = await postRes.json().catch(() => ({}));
                    throw new Error(
                        err.error ?? "Failed to save transcription",
                    );
                }

                toast.success("Transcribed in browser");
                onCompleteRef.current();
            } catch (err) {
                toast.error(
                    err instanceof Error
                        ? err.message
                        : "Browser transcription failed",
                );
            } finally {
                runningRef.current = false;
                setRun(null);
            }
        },
        [model],
    );

    const phaseFor = useCallback(
        (recordingId: string): BrowserTranscriptionPhase =>
            run && run.recordingId === recordingId ? run.phase : "idle",
        [run],
    );

    return useMemo(
        () => ({
            runningId: run?.recordingId ?? null,
            isRunning: run !== null,
            phaseFor,
            start,
        }),
        [run, phaseFor, start],
    );
}

/**
 * Button for an in-browser transcription. State comes from
 * `useBrowserTranscription`, so a menu item and this button share one run.
 * `variant="ink"` when it is the screen's primary way to transcribe.
 */
export function TranscribeInBrowserButton({
    phase,
    onStart,
    disabled,
    variant = "quiet",
}: {
    phase: BrowserTranscriptionPhase;
    onStart: () => void;
    disabled?: boolean;
    variant?: "quiet" | "ink";
}) {
    const busy = phase !== "idle";
    return (
        <Button
            onClick={onStart}
            size="compact"
            variant={variant}
            disabled={disabled || busy}
            title="Run Whisper in your browser. No API key required; audio never leaves your machine."
        >
            {busy ? (
                <>
                    <Loader2 className="size-4 animate-spin" />
                    {PHASE_LABEL[phase]}
                </>
            ) : (
                "Transcribe in browser"
            )}
        </Button>
    );
}
