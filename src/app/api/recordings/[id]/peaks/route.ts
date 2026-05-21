import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

const MAX_PEAKS = 2048;
const MIN_PEAKS = 32;

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new AppError(ErrorCode.INVALID_INPUT, "Invalid JSON body", 400);
    }

    const peaks =
        body && typeof body === "object" && "peaks" in body
            ? (body as { peaks: unknown }).peaks
            : null;

    if (!Array.isArray(peaks)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Expected { peaks: number[] }",
            400,
        );
    }

    if (peaks.length < MIN_PEAKS || peaks.length > MAX_PEAKS) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `peaks must contain between ${MIN_PEAKS} and ${MAX_PEAKS} values`,
            400,
        );
    }

    const normalized: number[] = [];
    for (const v of peaks) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "peaks must be finite numbers in [0, 1]",
                400,
            );
        }
        normalized.push(Math.round(v * 1000) / 1000);
    }

    const [recording] = await db
        .select({ id: recordings.id, waveformPeaks: recordings.waveformPeaks })
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

    if (recording.waveformPeaks) {
        return NextResponse.json({ stored: false });
    }

    // Conditional write: predicates on UPDATE so a concurrent DELETE
    // doesn't race; matches zero rows on tombstoned recordings.
    const result = await db
        .update(recordings)
        .set({ waveformPeaks: normalized, updatedAt: new Date() })
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
                sql`${recordings.waveformPeaks} is null`,
            ),
        );

    void result;

    return NextResponse.json({ stored: true });
});
