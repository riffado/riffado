import { OpenAI } from "openai";
import { fetchTranscription } from "@/lib/transcription/fetch";

interface TranscriptionClientOptions {
    apiKey: string;
    baseURL?: string;
    timeoutMs: number;
}

/** Create an OpenAI-compatible client for long-running audio transcription. */
export function createTranscriptionClient({
    apiKey,
    baseURL,
    timeoutMs,
}: TranscriptionClientOptions): OpenAI {
    return new OpenAI({
        apiKey,
        baseURL,
        timeout: timeoutMs,
        maxRetries: 0,
        fetch: (input, init) =>
            fetchTranscription(input, init ?? {}, timeoutMs),
    });
}
