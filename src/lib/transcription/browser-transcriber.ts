/**
 * Browser-based transcription using Transformers.js.
 *
 * Runs Whisper models entirely in the user's browser via WebAssembly --
 * no API key, no audio leaving the machine. This class lives on the main
 * thread and drives a Web Worker (`worker.ts`) that owns the heavy
 * Transformers.js pipeline so inference never blocks the UI thread.
 *
 * Audio must be decoded to mono 16 kHz PCM (`Float32Array`) before being
 * passed in -- see `decode-audio.ts`. The worker feeds those samples
 * straight to the pipeline.
 */

import type {
    TranscriptionModel,
    TranscriptionResult,
} from "@/types/transcription";

export type { TranscriptionModel, TranscriptionResult };

const MODEL_MAP: Record<TranscriptionModel, string> = {
    "whisper-tiny": "Xenova/whisper-tiny",
    "whisper-base": "Xenova/whisper-base",
    "whisper-small": "Xenova/whisper-small",
};

/** Coarse stages reported back to the UI while a transcription runs. */
export type BrowserTranscriptionStage = "loading-model" | "transcribing";

export interface BrowserTranscriptionProgress {
    stage: BrowserTranscriptionStage;
    /** 0-100 model-download progress; only present during `loading-model`. */
    percent?: number;
}

export class BrowserTranscriber {
    private worker: Worker | null = null;
    private isReady = false;

    /**
     * Initialize the transcription worker. Cheap and idempotent -- the
     * expensive model download happens lazily on the first `transcribe`.
     */
    async initialize(): Promise<void> {
        if (this.worker) {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker(
                    new URL("./worker.ts", import.meta.url),
                    { type: "module" },
                );

                const onReady = (event: MessageEvent) => {
                    if (event.data?.type === "ready") {
                        worker.removeEventListener("message", onReady);
                        this.isReady = true;
                        resolve();
                    }
                };

                worker.addEventListener("message", onReady);
                worker.addEventListener("error", (error) => {
                    reject(
                        new Error(
                            `Worker initialization failed: ${error.message}`,
                        ),
                    );
                });

                this.worker = worker;
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Transcribe decoded mono 16 kHz PCM samples with the given Whisper
     * model. The first call for a model downloads it (cached by the
     * browser afterwards), reported via `onProgress`.
     */
    async transcribe(
        samples: Float32Array,
        model: TranscriptionModel = "whisper-base",
        onProgress?: (progress: BrowserTranscriptionProgress) => void,
    ): Promise<TranscriptionResult> {
        const worker = this.worker;
        if (!worker || !this.isReady) {
            throw new Error(
                "Transcriber not initialized. Call initialize() first.",
            );
        }

        return new Promise((resolve, reject) => {
            const messageHandler = (event: MessageEvent) => {
                const { type, text, detectedLanguage, error, stage, percent } =
                    event.data ?? {};

                if (type === "progress") {
                    onProgress?.({ stage, percent });
                } else if (type === "complete") {
                    worker.removeEventListener("message", messageHandler);
                    resolve({ text, detectedLanguage });
                } else if (type === "error") {
                    worker.removeEventListener("message", messageHandler);
                    reject(new Error(error));
                }
            };

            worker.addEventListener("message", messageHandler);

            // Transfer the underlying buffer to avoid copying potentially
            // large sample arrays across the worker boundary.
            worker.postMessage(
                {
                    type: "transcribe",
                    samples,
                    model: MODEL_MAP[model],
                },
                [samples.buffer],
            );
        });
    }

    /** Tear down the worker and free its loaded model. */
    terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}
