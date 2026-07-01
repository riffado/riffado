"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserTranscriber } from "@/lib/transcription/browser-transcriber";
import { decodeAudioToMono16k } from "@/lib/transcription/decode-audio";
import type { TranscriptionModel } from "@/types/transcription";

interface RunOptions {
    recordingId: string;
    model: TranscriptionModel;
}

/**
 * Drives the full in-browser transcription flow for one recording:
 *
 *   1. download the audio from our own API
 *   2. decode it to mono 16 kHz PCM (main thread; OfflineAudioContext)
 *   3. run Whisper in a Web Worker via Transformers.js
 *   4. POST the resulting transcript to be stored server-side
 *
 * Nothing but the final transcript text leaves the browser. The heavy
 * Transformers.js bundle + model weights are only fetched the first
 * time `run` is invoked, so importing this hook is cheap.
 *
 * `status` is a human-readable progress string (or null when idle) the
 * caller can surface in the UI.
 */
export function useBrowserTranscription() {
    const [status, setStatus] = useState<string | null>(null);
    const transcriberRef = useRef<BrowserTranscriber | null>(null);

    // Tear the worker down on unmount so its loaded model is freed.
    useEffect(() => {
        return () => {
            transcriberRef.current?.terminate();
            transcriberRef.current = null;
        };
    }, []);

    const run = useCallback(
        async ({ recordingId, model }: RunOptions): Promise<void> => {
            setStatus("Downloading audio…");
            const audioResponse = await fetch(
                `/api/recordings/${recordingId}/audio`,
            );
            if (!audioResponse.ok) {
                throw new Error("Failed to download audio for transcription");
            }
            const blob = await audioResponse.blob();

            setStatus("Decoding audio…");
            const samples = await decodeAudioToMono16k(blob);

            let transcriber = transcriberRef.current;
            if (!transcriber) {
                transcriber = new BrowserTranscriber();
                transcriberRef.current = transcriber;
            }

            setStatus("Loading model…");
            await transcriber.initialize();

            const result = await transcriber.transcribe(
                samples,
                model,
                (progress) => {
                    if (progress.stage === "loading-model") {
                        setStatus(
                            progress.percent != null
                                ? `Loading model… ${progress.percent}%`
                                : "Loading model…",
                        );
                    } else {
                        setStatus("Transcribing…");
                    }
                },
            );

            if (!result.text.trim()) {
                throw new Error(
                    "Transcription produced no text (the audio may be silent)",
                );
            }

            setStatus("Saving…");
            const saveResponse = await fetch(
                `/api/recordings/${recordingId}/transcribe/browser`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: result.text,
                        detectedLanguage: result.detectedLanguage,
                        model,
                    }),
                },
            );
            if (!saveResponse.ok) {
                const error = await saveResponse.json().catch(() => ({}));
                throw new Error(error.error || "Failed to save transcript");
            }

            setStatus(null);
        },
        [],
    );

    const reset = useCallback(() => setStatus(null), []);

    return { run, status, reset };
}
