import { ChatTranscribeFormatError } from "@/lib/transcription/chat-transcribe";
import { ElevenLabsFileTooLargeError } from "@/lib/transcription/elevenlabs-transcribe";
import {
    GeminiTranscribeFormatError,
    GeminiTranscribeSizeError,
} from "@/lib/transcription/gemini-transcribe";

/**
 * Whether an unattended retry of the same audio against the same provider
 * can succeed. `permanent` failures only change when the user or operator
 * changes something (the file, the provider, its limits).
 */
export type TranscribeFailureKind = "permanent" | "transient";

export interface TranscribeFailureClass {
    kind: TranscribeFailureKind;
    /** Upstream HTTP status, when the provider returned one. */
    status?: number;
}

const PERMANENT_STATUSES = new Set([400, 413, 415, 422]);

function providerStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const status = (error as { status?: unknown }).status;
    if (typeof status !== "number" || !Number.isInteger(status)) {
        return undefined;
    }
    return status >= 400 && status <= 599 ? status : undefined;
}

/**
 * Classify a provider-call error. Request-shape rejections (400, 413,
 * 415, 422) and local size/format checks are permanent; network errors,
 * timeouts, 408, 429, 5xx and anything unrecognised are transient.
 */
export function classifyTranscribeError(
    error: unknown,
): TranscribeFailureClass {
    if (
        error instanceof ElevenLabsFileTooLargeError ||
        error instanceof GeminiTranscribeSizeError ||
        error instanceof GeminiTranscribeFormatError ||
        error instanceof ChatTranscribeFormatError
    ) {
        return { kind: "permanent" };
    }
    const status = providerStatus(error);
    if (status !== undefined && PERMANENT_STATUSES.has(status)) {
        return { kind: "permanent", status };
    }
    return { kind: "transient", status };
}
