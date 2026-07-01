import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { storeBrowserTranscription } from "@/lib/transcription/store-transcript";
import type { TranscribeErrorCode } from "@/lib/transcription/transcribe-recording";

type IdContext = { params: Promise<{ id: string }> };

// Whisper transcripts are bounded by recording length; this cap only
// exists to reject pathological / abusive payloads, not legitimate
// long-meeting transcripts (a 3 h recording is well under this).
const MAX_TRANSCRIPT_CHARS = 5_000_000;

const browserTranscriptSchema = z.object({
    text: z.string().min(1).max(MAX_TRANSCRIPT_CHARS),
    // ISO 639-1-ish code Whisper attaches; nullable when the model
    // didn't report one. Capped defensively.
    detectedLanguage: z.string().max(16).nullish(),
    model: z.enum(["whisper-tiny", "whisper-base", "whisper-small"]),
});

/**
 * Store a transcript produced in the user's browser via Transformers.js
 * (Whisper in WebAssembly). The heavy lifting -- model download, audio
 * decode, inference -- happens client-side; this endpoint only persists
 * the result through the same path as server-side transcripts
 * (encrypted at rest, title auto-generation, webhook emission).
 *
 * Request body:
 *   - `text`: the transcript (required, non-empty)
 *   - `detectedLanguage`: Whisper-detected language code (optional)
 *   - `model`: which Whisper model produced it (recorded as metadata)
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const parsed = browserTranscriptSchema.safeParse(
        await request.json().catch(() => null),
    );
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid browser transcript payload",
            400,
        );
    }

    // Reject whitespace-only transcripts (Whisper can emit these for
    // silent audio) so we don't store an empty transcript that the UI
    // would render as a successful result.
    if (!parsed.data.text.trim()) {
        throw new AppError(ErrorCode.INVALID_INPUT, "Transcript is empty", 400);
    }

    const result = await storeBrowserTranscription(session.user.id, id, {
        text: parsed.data.text,
        detectedLanguage: parsed.data.detectedLanguage ?? null,
        model: parsed.data.model,
    });

    if (!result.success) {
        throw mapErrorCodeToAppError(result.errorCode, result.error);
    }

    return NextResponse.json({
        transcription: result.text ?? "",
        detectedLanguage: result.detectedLanguage ?? null,
    });
});

function mapErrorCodeToAppError(
    code: TranscribeErrorCode | undefined,
    message: string | undefined,
): AppError {
    const msg = message ?? "Failed to store transcript";
    switch (code) {
        case "RECORDING_NOT_FOUND":
            return new AppError(ErrorCode.RECORDING_NOT_FOUND, msg, 404);
        case "RECORDING_DELETED":
            return new AppError(ErrorCode.NOT_FOUND, msg, 410);
        default:
            return new AppError(ErrorCode.TRANSCRIPTION_FAILED, msg, 500);
    }
}
