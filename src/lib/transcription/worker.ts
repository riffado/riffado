/// <reference lib="webworker" />

import { type PipelineType, pipeline } from "@xenova/transformers";

type Pipe = Awaited<ReturnType<typeof pipeline>>;

// Cache one pipeline per model id so switching recordings (same model)
// doesn't re-download or re-instantiate. Whisper models are tens to a
// few hundred MB; the browser HTTP cache persists the weights, but the
// in-memory pipeline still needs rebuilding across worker reloads.
const pipelines = new Map<string, Pipe>();

async function getTranscriber(model: string): Promise<Pipe> {
    const cached = pipelines.get(model);
    if (cached) {
        return cached;
    }
    const pipe = await pipeline(
        "automatic-speech-recognition" as PipelineType,
        model,
        {
            // Report model-download progress back to the main thread so
            // the UI can show a percentage on first run.
            progress_callback: (data: {
                status?: string;
                progress?: number;
            }) => {
                if (data?.status === "progress") {
                    self.postMessage({
                        type: "progress",
                        stage: "loading-model",
                        percent:
                            typeof data.progress === "number"
                                ? Math.round(data.progress)
                                : undefined,
                    });
                }
            },
        },
    );
    pipelines.set(model, pipe);
    return pipe;
}

self.addEventListener("message", async (event: MessageEvent) => {
    const { type, samples, model } = event.data ?? {};

    if (type !== "transcribe") {
        return;
    }

    try {
        const pipe = await getTranscriber(model);

        self.postMessage({ type: "progress", stage: "transcribing" });

        type TranscriberResult = {
            text: string;
            chunks?: { language?: string }[];
        };

        type Transcriber = (
            input: Float32Array,
            options: {
                return_timestamps: boolean;
                chunk_length_s: number;
                stride_length_s: number;
            },
        ) => Promise<TranscriberResult>;

        const result = await (pipe as Transcriber)(samples as Float32Array, {
            return_timestamps: false,
            chunk_length_s: 30,
            stride_length_s: 5,
        });

        self.postMessage({
            type: "complete",
            text: result.text,
            detectedLanguage: result.chunks?.[0]?.language ?? null,
        });
    } catch (error) {
        self.postMessage({
            type: "error",
            error:
                error instanceof Error ? error.message : "Transcription failed",
        });
    }
});

self.postMessage({ type: "ready" });
