import type { SQL } from "drizzle-orm";
import { and, desc, eq, exists, gte, isNull, lt, not, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudDevices,
    recordings,
    transcriptions,
} from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";
import {
    decodeRecordingCursor,
    encodeRecordingCursor,
    serializeRecording,
} from "@/lib/v1/serialize";

function parseLimit(value: string | null): number {
    if (!value) return 50;
    const limit = Number.parseInt(value, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "limit must be an integer from 1 to 100",
            400,
            { field: "limit" },
        );
    }
    return limit;
}

function parseDateFilter(value: string | null, field: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `${field} must be an ISO timestamp`,
            400,
            { field },
        );
    }
    return date;
}

function parseBooleanFilter(value: string | null): boolean | null {
    if (value == null) return null;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new AppError(
        ErrorCode.INVALID_INPUT,
        "has_transcription must be true or false",
        400,
        { field: "has_transcription" },
    );
}

export const GET = apiHandler(async (request: Request) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401);
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const createdSince = parseDateFilter(
        url.searchParams.get("created_since"),
        "created_since",
    );
    const updatedSince = parseDateFilter(
        url.searchParams.get("updated_since"),
        "updated_since",
    );
    const hasTranscription = parseBooleanFilter(
        url.searchParams.get("has_transcription"),
    );

    const conditions: SQL[] = [
        eq(recordings.userId, authn.user.id),
        isNull(recordings.deletedAt),
    ];

    if (createdSince) {
        conditions.push(gte(recordings.createdAt, createdSince));
    }
    if (updatedSince) {
        conditions.push(gte(recordings.updatedAt, updatedSince));
    }

    const cursorRaw = url.searchParams.get("cursor");
    if (cursorRaw) {
        const cursor = decodeRecordingCursor(cursorRaw);
        if (!cursor) {
            throw new AppError(ErrorCode.INVALID_INPUT, "Invalid cursor", 400, {
                field: "cursor",
            });
        }
        conditions.push(
            or(
                lt(recordings.updatedAt, cursor.updatedAt),
                and(
                    eq(recordings.updatedAt, cursor.updatedAt),
                    lt(recordings.id, cursor.id),
                ),
            ) as SQL,
        );
    }

    // Transcripts are 1:N per recording (Plaud + the user's own coexist), so a
    // join would duplicate recordings. Use a correlated EXISTS for both the
    // has_transcription filter and the boolean flag.
    const transcriptExists = exists(
        db
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, recordings.id),
                    eq(transcriptions.userId, authn.user.id),
                ),
            ),
    );

    if (hasTranscription === true) {
        conditions.push(transcriptExists);
    }
    if (hasTranscription === false) {
        conditions.push(not(transcriptExists));
    }

    const rows = await db
        .select({
            recording: recordings,
            device: plaudDevices,
            enhancement: aiEnhancements,
            hasTranscript: transcriptExists,
        })
        .from(recordings)
        .leftJoin(
            plaudDevices,
            and(
                eq(plaudDevices.userId, authn.user.id),
                eq(plaudDevices.serialNumber, recordings.deviceSn),
            ),
        )
        .leftJoin(
            aiEnhancements,
            and(
                eq(aiEnhancements.recordingId, recordings.id),
                eq(aiEnhancements.userId, authn.user.id),
            ),
        )
        .where(and(...conditions))
        .orderBy(desc(recordings.updatedAt), desc(recordings.id))
        .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);

    return NextResponse.json({
        data: pageRows.map((row) =>
            serializeRecording(row.recording, row.device, {
                hasTranscription: Boolean(row.hasTranscript),
                hasSummary: Boolean(row.enhancement),
            }),
        ),
        next_cursor:
            hasMore && last
                ? encodeRecordingCursor({
                      updatedAt: last.recording.updatedAt,
                      id: last.recording.id,
                  })
                : null,
        has_more: hasMore,
    });
});
