"use client";

import { Cpu, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { transcribeInBrowser } from "@/lib/transcription/browser-transcriber";
import type { TranscriptionModel } from "@/types/transcription";

interface Props {
    recordingId: string;
    /** Disabled while another action is running. */
    disabled?: boolean;
    /** Called after a successful POST so the parent can refresh data. */
    onComplete: () => void;
    /** Defaults to `"whisper-base"` (~75MB download, multilingual). */
    model?: TranscriptionModel;
}

type Phase = "idle" | "downloading-audio" | "loading-model" | "transcribing";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
    "downloading-audio": "Downloading audio…",
    "loading-model": "Loading Whisper (one-time download)…",
    transcribing: "Transcribing locally…",
};

/**
 * Run Whisper in the browser via Transformers.js, then POST the result
 * to `/api/recordings/[id]/transcription/from-browser`. No API key
 * needed; audio never leaves the user's machine.
 *
 * The Whisper model is fetched from the Hugging Face CDN on first use
 * (~75MB for whisper-base) and cached by the browser, so subsequent
 * transcriptions are instant-start. Cancellation is best-effort: if the
 * user closes the tab mid-transcribe the worker is terminated by the
 * browser.
 */
export function TranscribeInBrowserButton({
    recordingId,
    disabled,
    onComplete,
    model = "whisper-base",
}: Props) {
    const [phase, setPhase] = useState<Phase>("idle");

    const run = useCallback(async () => {
        try {
            setPhase("downloading-audio");
            const audioRes = await fetch(
                `/api/recordings/${recordingId}/audio`,
            );
            if (!audioRes.ok) {
                throw new Error(`Failed to fetch audio (${audioRes.status})`);
            }
            const blob = await audioRes.blob();
            const file = new File([blob], `recording-${recordingId}`, {
                type: blob.type || "audio/mpeg",
            });

            setPhase("loading-model");
            const result = await transcribeInBrowser(file, model, (status) => {
                if (status === "transcribing") setPhase("transcribing");
            });

            const postRes = await fetch(
                `/api/recordings/${recordingId}/transcription/from-browser`,
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
                throw new Error(err.error ?? "Failed to save transcription");
            }

            toast.success("Transcribed in browser");
            onComplete();
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Browser transcription failed",
            );
        } finally {
            setPhase("idle");
        }
    }, [recordingId, model, onComplete]);

    const busy = phase !== "idle";

    return (
        <Button
            onClick={run}
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            title="Run Whisper in your browser. No API key required; audio never leaves your machine."
        >
            {busy ? (
                <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {PHASE_LABEL[phase as Exclude<Phase, "idle">]}
                </>
            ) : (
                <>
                    <Cpu className="size-4 mr-2" />
                    Transcribe in browser
                </>
            )}
        </Button>
    );
}
