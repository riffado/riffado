import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    type TranscribeErrorCode,
    transcribeRecording,
} from "@/lib/transcription/transcribe-recording";

type IdContext = { params: Promise<{ id: string }> };

/**
 * Manual "Transcribe" / "Re-transcribe" endpoint. Thin wrapper around the
 * shared `transcribeRecording` worker so the manual and sync-triggered
 * paths cannot drift (issue #101 traced back to this duplication: the
 * manual path was missing the `chunking_strategy` parameter, the OpenAI
 * chat-style provider routing for OpenRouter, and the `language` hint).
 *
 * Request body (all optional):
 *   - `providerId`: use a specific configured provider instead of the
 *     user's default transcription provider. Looked up user-scoped.
 *   - `model`: override the provider's default model for this call.
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;
    const providerId =
        typeof body.providerId === "string" ? body.providerId : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;

    // `force: true` so a manual "Re-transcribe" click always re-hits the
    // provider and overwrites the existing transcript. Without this the
    // worker's idempotent short-circuit would silently no-op the click
    // (and any providerId/model override sent with it).
    const result = await transcribeRecording(session.user.id, id, {
        providerId,
        model,
        force: true,
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
    const msg = message ?? "Transcription failed";
    switch (code) {
        case "RECORDING_NOT_FOUND":
            return new AppError(ErrorCode.RECORDING_NOT_FOUND, msg, 404);
        case "RECORDING_DELETED":
            return new AppError(ErrorCode.NOT_FOUND, msg, 410);
        case "NO_TRANSCRIPTION_PROVIDER":
            return new AppError(ErrorCode.NO_TRANSCRIPTION_PROVIDER, msg, 400);
        case "TRANSCRIPTION_IN_PROGRESS":
            // 409 Conflict — a previous click is still running. The UI
            // shows the in-flight chip from `transcription_in_progress`
            // in the v1 payload, so the user does not need to retry;
            // they just wait for the existing run to finish.
            return new AppError(ErrorCode.CONFLICT, msg, 409);
        default:
            return new AppError(ErrorCode.TRANSCRIPTION_FAILED, msg, 500);
    }
}
