import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudDevices,
    recordings,
    transcriptions,
} from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import {
    decodeRecordingCursor,
    encodeRecordingCursor,
    serializeRecording,
} from "@/lib/v1/serialize";

function parseLimit(value: string | null): number {
    if (!value) return 50;
    const limit = Number.parseInt(value, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("limit must be an integer from 1 to 100");
    }
    return limit;
}

function parseDateFilter(value: string | null, name: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`${name} must be an ISO timestamp`);
    }
    return date;
}

function parseBooleanFilter(value: string | null): boolean | null {
    if (value == null) return null;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("has_transcription must be true or false");
}

export async function GET(request: Request) {
    try {
        const authn = await authenticateRequest(request);
        if (!authn) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const url = new URL(request.url);
        let limit: number;
        let createdSince: Date | null;
        let updatedSince: Date | null;
        let hasTranscription: boolean | null;

        try {
            limit = parseLimit(url.searchParams.get("limit"));
            createdSince = parseDateFilter(
                url.searchParams.get("created_since"),
                "created_since",
            );
            updatedSince = parseDateFilter(
                url.searchParams.get("updated_since"),
                "updated_since",
            );
            hasTranscription = parseBooleanFilter(
                url.searchParams.get("has_transcription"),
            );
        } catch (error) {
            return NextResponse.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Invalid query parameter",
                },
                { status: 400 },
            );
        }

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
                return NextResponse.json(
                    { error: "Invalid cursor" },
                    { status: 400 },
                );
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

        if (hasTranscription === true) {
            conditions.push(isNotNull(transcriptions.id));
        }
        if (hasTranscription === false) {
            conditions.push(isNull(transcriptions.id));
        }

        const rows = await db
            .select({
                recording: recordings,
                device: plaudDevices,
                transcription: transcriptions,
                enhancement: aiEnhancements,
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
                transcriptions,
                and(
                    eq(transcriptions.recordingId, recordings.id),
                    eq(transcriptions.userId, authn.user.id),
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
                serializeRecording(
                    row.recording,
                    row.device,
                    row.transcription,
                    row.enhancement,
                ),
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
    } catch (error) {
        console.error("Error fetching v1 recordings:", error);
        return NextResponse.json(
            { error: "Failed to fetch recordings" },
            { status: 500 },
        );
    }
}
