import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, recordings } from "@/db/schema";
import { summarizeRecording } from "@/lib/ai/summarize-recording";
import { requireApiSession } from "@/lib/auth-server";
import { decryptJsonField, decryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));
    const presetId = (body.preset as string) || undefined;

    const result = await summarizeRecording(session.user.id, id, {
        presetId,
    });

    if (!result.success) {
        const code = result.errorCode;
        if (code === "RECORDING_NOT_FOUND") {
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                result.error || "Recording not found",
                404,
            );
        }
        if (code === "RECORDING_DELETED") {
            throw new AppError(
                ErrorCode.NOT_FOUND,
                result.error || "Recording was deleted",
                410,
            );
        }
        if (code === "NO_TRANSCRIPTION") {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                result.error ||
                    "No transcription available. Transcribe the recording first.",
                400,
            );
        }
        if (code === "NO_AI_PROVIDER") {
            throw new AppError(
                ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
                result.error || "No AI provider configured",
                400,
            );
        }
        throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            result.error || "Summary generation failed",
            500,
        );
    }

    return NextResponse.json({
        summary: result.summary,
        keyPoints: result.keyPoints,
        actionItems: result.actionItems,
        provider: result.provider,
        model: result.model,
    });
});

// GET - Fetch existing summary
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    const [enhancement] = await db
        .select()
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!enhancement) {
        return NextResponse.json({ summary: null });
    }

    // Decrypt content fields before returning to the client. Legacy
    // plaintext rows pass through verbatim during the backfill window.
    return NextResponse.json({
        summary: decryptText(enhancement.summary),
        keyPoints: decryptJsonField<string[]>(enhancement.keyPoints),
        actionItems: decryptJsonField<string[]>(enhancement.actionItems),
        provider: enhancement.provider,
        model: enhancement.model,
        createdAt: enhancement.createdAt,
    });
});

// DELETE - Remove existing summary
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    await db.transaction(async (tx) => {
        const deleted = await tx
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            )
            .returning({ id: aiEnhancements.id });

        if (deleted.length > 0) {
            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                        isNull(recordings.deletedAt),
                    ),
                );
        }
    });

    return NextResponse.json({ success: true });
});
