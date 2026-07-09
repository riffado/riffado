/**
 * Browser-based transcription using Transformers.js.
 * Runs Whisper models in the browser via WebAssembly.
 */

import { decodeAudioToMono16k } from "@/lib/transcription/decode-audio";
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

export class BrowserTranscriber {
    private worker: Worker | null = null;
    private isReady = false;

    /** Initialize the transcription worker. */
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
     * Transcribe an audio file using the browser-based model.
     *
     * Transformers.js ASR expects raw mono PCM samples at the model's
     * sampling rate, not encoded MP3/Opus bytes. Decode and resample the
     * file before transferring the `Float32Array` to the worker.
     */
    async transcribe(
        audioFile: File,
        model: TranscriptionModel = "whisper-base",
        onProgress?: (status: string) => void,
    ): Promise<TranscriptionResult> {
        const worker = this.worker;
        if (!worker || !this.isReady) {
            throw new Error(
                "Transcriber not initialized. Call initialize() first.",
            );
        }

        onProgress?.("decoding-audio");
        const samples = await decodeAudioToMono16k(audioFile);

        return new Promise((resolve, reject) => {
            const messageHandler = (event: MessageEvent) => {
                const { type, text, detectedLanguage, error, status } =
                    event.data ?? {};

                if (type === "progress" && onProgress) {
                    onProgress(status);
                } else if (type === "complete") {
                    worker.removeEventListener("message", messageHandler);
                    resolve({ text, detectedLanguage });
                } else if (type === "error") {
                    worker.removeEventListener("message", messageHandler);
                    reject(new Error(error));
                }
            };

            worker.addEventListener("message", messageHandler);
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

    /** Clean up the worker. */
    terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}

/** Convenience function to transcribe audio in the browser. */
export async function transcribeInBrowser(
    audioFile: File,
    model: TranscriptionModel = "whisper-base",
    onProgress?: (status: string) => void,
): Promise<TranscriptionResult> {
    const transcriber = new BrowserTranscriber();
    try {
        await transcriber.initialize();
        return await transcriber.transcribe(audioFile, model, onProgress);
    } finally {
        transcriber.terminate();
    }
}
