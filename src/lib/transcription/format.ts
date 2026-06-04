import type {
    TranscriptionCreateParamsNonStreaming,
    TranscriptionDiarized,
    TranscriptionVerbose,
} from "openai/resources/audio/transcriptions";

export type ResponseFormat = "diarized_json" | "json" | "verbose_json";

export function getResponseFormat(model: string): ResponseFormat {
    if (model.includes("diarize")) return "diarized_json";
    if (model.startsWith("gpt-4o")) return "json";
    return "verbose_json";
}

export function parseTranscriptionResponse(
    transcription: unknown,
    responseFormat: ResponseFormat,
): { text: string; detectedLanguage: string | null } {
    if (responseFormat === "diarized_json") {
        const diarized = transcription as TranscriptionDiarized;
        const text = (diarized.segments ?? [])
            .map((seg) => `${seg.speaker}: ${seg.text}`)
            .join("\n");
        return { text, detectedLanguage: null };
    }

    if (responseFormat === "verbose_json") {
        const verbose = transcription as TranscriptionVerbose;
        return {
            text: verbose.text,
            detectedLanguage: verbose.language ?? null,
        };
    }

    const plain = transcription as { text?: string };
    const text =
        typeof transcription === "string" ? transcription : (plain.text ?? "");
    return { text, detectedLanguage: null };
}

export function buildTranscriptionParams(args: {
    file: File;
    model: string;
    responseFormat: ResponseFormat;
    language?: string;
}): TranscriptionCreateParamsNonStreaming {
    const { file, model, responseFormat, language } = args;

    // gpt-4o-transcribe models use a different parameter set and don't
    // accept legacy Whisper params like temperature or prompt.
    const isGpt4oTranscribe = model.startsWith("gpt-4o");

    const params: TranscriptionCreateParamsNonStreaming = {
        file,
        model,
        response_format: responseFormat,
        ...(responseFormat === "diarized_json"
            ? { chunking_strategy: "auto" as const }
            : {}),
        ...(language ? { language } : {}),
        // Anti-hallucination: force deterministic decoding so the model
        // doesn't speculatively guess on silence or background noise.
        ...(!isGpt4oTranscribe ? { temperature: 0 } : {}),
        // Anti-hallucination: steer the model away from YouTube-style
        // hallucinations ("Thanks for watching", subtitle URLs, etc.)
        // by priming it with realistic punctuation.
        ...(!isGpt4oTranscribe
            ? { prompt: "Transcribe the spoken audio accurately." }
            : {}),
    };

    // Anti-hallucination: wipe the decoder's short-term memory after each
    // chunk so a single glitch can't cascade into a repeat loop. This is a
    // Whisper-native parameter accepted by self-hosted servers (faster-whisper,
    // whisper.cpp, etc.) but not part of the OpenAI SDK type definition.
    if (!isGpt4oTranscribe) {
        (
            params as unknown as Record<string, unknown>
        ).condition_on_previous_text = false;
    }

    return params;
}
