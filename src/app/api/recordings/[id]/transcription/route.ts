import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/recordings/[id]/transcription
 * Manually update an existing transcription's text. The caller supplies
 * the plaintext; this route encrypts before storing. Fails 404 if no
 * transcription row exists (use the /transcribe route to create one).
 */
export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));
    if (typeof body.text !== "string") {
        throw new AppError(ErrorCode.INVALID_INPUT, "text is required", 400);
    }
    const newText = body.text;

    // Verify recording ownership.
    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, userId),
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

    const result = await db
        .update(transcriptions)
        .set({ text: encryptText(newText) as unknown as string })
        .where(
            and(
                eq(transcriptions.recordingId, id),
                eq(transcriptions.userId, userId),
            ),
        )
        .returning({ id: transcriptions.id });

    if (result.length === 0) {
        throw new AppError(
            ErrorCode.NOT_FOUND,
            "No transcription found for this recording",
            404,
        );
    }

    return NextResponse.json({ success: true });
});
