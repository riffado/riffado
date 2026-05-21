/// <reference lib="webworker" />

import { type PipelineType, pipeline } from "@xenova/transformers";

// @ts-expect-error -- disable local model cache in browser
self.ONNX_CACHE = false;

let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;

async function initTranscriber(model: string) {
    if (!transcriber) {
        transcriber = await pipeline(
            "automatic-speech-recognition" as PipelineType,
            model,
            { revision: "main" },
        );
    }
    return transcriber;
}

self.addEventListener("message", async (event) => {
    const { type, audioData, model } = event.data;

    if (type === "transcribe") {
        try {
            const pipe = await initTranscriber(model);

            self.postMessage({ type: "progress", status: "transcribing" });

            type TranscriberResult = {
                text: string;
                chunks?: { language?: string }[];
            };

            type Transcriber = (
                input: unknown,
                options: {
                    return_timestamps: boolean;
                    chunk_length_s: number;
                    stride_length_s: number;
                },
            ) => Promise<TranscriberResult>;

            const result = await (pipe as Transcriber)(audioData, {
                return_timestamps: false,
                chunk_length_s: 30,
                stride_length_s: 5,
            });

            self.postMessage({
                type: "complete",
                text: result.text,
                detectedLanguage: result.chunks?.[0]?.language || "en",
            });
        } catch (error) {
            self.postMessage({
                type: "error",
                error:
                    error instanceof Error
                        ? error.message
                        : "Transcription failed",
            });
        }
    }
});

self.postMessage({ type: "ready" });
