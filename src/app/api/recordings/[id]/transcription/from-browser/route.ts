import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { storeBrowserTranscription } from "@/lib/transcription/transcribe-recording";

type IdContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
    text: z.string().trim().min(1).max(200_000),
    detectedLanguage: z
        .string()
        .trim()
        .max(10)
        .nullish()
        .transform((v) => (v ? v : null)),
    model: z.string().trim().min(1).max(100),
});

/**
 * Persist a transcription produced in the user's browser by
 * Transformers.js / Whisper. The client transcribes locally then POSTs
 * the result here; the server never sees the audio for this path.
 *
 * Request body: `{ text: string (1-200000 chars), model: string, detectedLanguage?: string }`.
 * `model` is the browser model id (e.g. `whisper-base`), stored verbatim
 * for audit. `provider` is hard-coded to `"browser"` server-side so the
 * client cannot mislabel a server-side transcript as browser-produced.
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Invalid request body",
            400,
            { issues: parsed.error.flatten() },
        );
    }

    const result = await storeBrowserTranscription({
        userId: session.user.id,
        recordingId: id,
        text: parsed.data.text,
        detectedLanguage: parsed.data.detectedLanguage,
        model: parsed.data.model,
    });

    if (!result.success) {
        switch (result.errorCode) {
            case "RECORDING_NOT_FOUND":
                throw new AppError(
                    ErrorCode.RECORDING_NOT_FOUND,
                    result.error ?? "Recording not found",
                    404,
                );
            case "RECORDING_DELETED":
                throw new AppError(
                    ErrorCode.NOT_FOUND,
                    result.error ?? "Recording was deleted",
                    410,
                );
            default:
                throw new AppError(
                    ErrorCode.TRANSCRIPTION_FAILED,
                    result.error ?? "Failed to store browser transcription",
                    500,
                );
        }
    }

    return NextResponse.json({
        transcription: result.text ?? "",
        detectedLanguage: result.detectedLanguage ?? null,
    });
});
