import { createHash } from "node:crypto";
import * as path from "node:path";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { parseBuffer } from "music-metadata";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudDevices,
    recordings,
    transcriptions,
} from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { encryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { getAudioMimeType } from "@/lib/utils";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";
import {
    decodeRecordingCursor,
    encodeRecordingCursor,
    serializeRecording,
} from "@/lib/v1/serialize";

const CONTEXT_MAX_LEN = 4000;

const ACCEPTED_UPLOAD_EXTENSIONS = new Set([
    ".mp3",
    ".mp4",
    ".m4a",
    ".wav",
    ".ogg",
    ".opus",
    ".webm",
    ".aac",
    ".flac",
]);
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const EXTERNAL_ID_MAX_LEN = 255;

async function probeDurationMs(
    buffer: Uint8Array,
    mimeType: string,
): Promise<number> {
    try {
        const { format } = await parseBuffer(
            buffer,
            { mimeType, size: buffer.byteLength },
            { duration: true },
        );
        const sec = format.duration ?? 0;
        if (sec > 0) return Math.round(sec * 1000);
        return 0;
    } catch (err) {
        console.error("Audio metadata parse failed:", err);
        return 0;
    }
}

function readMultipartField(
    formData: FormData,
    key: string,
): string | undefined {
    const value = formData.get(key);
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

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
});

/**
 * Programmatic upload — server-to-server counterpart of the browser
 * `/api/recordings/upload` endpoint. Distinct route on purpose:
 *
 *  - accepts API keys (via `authenticateRequest`) instead of only browser
 *    sessions, so integrating systems (meeting platforms, telephony
 *    pipelines) can post recordings with a `Bearer op_...` token;
 *  - takes an optional `external_id` correlation handle that round-trips
 *    into every subsequent webhook, so the caller can match a
 *    `transcription.completed` event back to its own row without keeping
 *    a separate mapping table;
 *  - is idempotent on `(user_id, external_id)` — a retry with the same
 *    `external_id` short-circuits to the existing row with HTTP 200
 *    instead of creating a duplicate (and instead of orphaning the
 *    already-uploaded blob).
 *
 * The browser path keeps its own route because its trust model is
 * different (CSRF, no rate-limit headers, no external_id concept).
 */
export const POST = apiHandler(async (request: Request) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401);
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!fileEntry || !(fileEntry instanceof File)) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "No file provided",
            400,
            { field: "file" },
        );
    }
    const file = fileEntry;

    if (file.size > MAX_UPLOAD_BYTES) {
        throw new AppError(
            ErrorCode.FILE_TOO_LARGE,
            "File exceeds the 500 MB size limit",
            413,
        );
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ACCEPTED_UPLOAD_EXTENSIONS.has(ext)) {
        throw new AppError(
            ErrorCode.INVALID_FILE_FORMAT,
            `Unsupported format. Accepted: ${[...ACCEPTED_UPLOAD_EXTENSIONS].join(", ")}`,
            400,
        );
    }

    const externalId = readMultipartField(formData, "external_id");
    if (externalId && externalId.length > EXTERNAL_ID_MAX_LEN) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `external_id must be ${EXTERNAL_ID_MAX_LEN} characters or fewer`,
            400,
            { field: "external_id" },
        );
    }

    // `auto_transcribe` defaults to true because the only reason a
    // server-to-server integration POSTs an audio file is to get a
    // transcript back via webhook — having to make a second
    // /transcribe call after every upload would be pure ceremony.
    // Callers that want to defer (e.g. batch-upload first, transcribe
    // later) can opt out with auto_transcribe=false. The dashboard
    // upload path stays separate (browser session, immediate UI
    // feedback, doesn't benefit from this gate).
    const autoTranscribeRaw = readMultipartField(formData, "auto_transcribe");
    const autoTranscribe = autoTranscribeRaw !== "false";

    // Free-text context the caller supplies up front so the AI tasks
    // don't have to guess. Two consumers downstream:
    //   - Whisper's `prompt` field (truncated to its 244-token budget)
    //     gets a primer that contains names + jargon, dramatically
    //     improving acoustic recognition of proper nouns ("Eibach",
    //     not "Eich-Bach"; "Lexware", not "Lexwerb").
    //   - The summary system message prepends the context so speaker
    //     attribution and customer/project framing aren't reverse-
    //     engineered from dialogue cues alone.
    // 4000 chars is generous — plenty for a participant list, the
    // customer name, and a paragraph of context — but capped so the
    // column doesn't grow unboundedly via abuse.
    const contextField = readMultipartField(formData, "context");
    if (contextField && contextField.length > CONTEXT_MAX_LEN) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `context must be ${CONTEXT_MAX_LEN} characters or fewer`,
            400,
            { field: "context" },
        );
    }

    // Idempotency short-circuit — same caller retrying the same upload
    // (e.g. our webhook receiver retrying after a network blip) should
    // map to the same row, not a duplicate. We do this BEFORE reading
    // the file body so a retry is cheap.
    if (externalId) {
        const [existing] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, authn.user.id),
                    eq(recordings.externalId, externalId),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);
        if (existing) {
            return NextResponse.json(
                serializeRecording(existing, null, null, null),
                { status: 200 },
            );
        }
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const fileId = `uploaded-${nanoid()}`;
    const storageKey = `${authn.user.id}/${fileId}${ext}`;
    const contentType = getAudioMimeType(storageKey);

    const md5 = createHash("md5").update(buffer).digest("hex");
    const durationMs = await probeDurationMs(buffer, contentType);
    if (durationMs === 0) {
        throw new AppError(
            ErrorCode.INVALID_FILE_FORMAT,
            "File does not contain a valid audio stream",
            422,
        );
    }

    const explicitName = readMultipartField(formData, "name");
    const basename =
        explicitName ??
        path.basename(file.name, ext) ??
        // Fallback that never fires in practice — File.name is required
        // by the spec, and path.basename of any string returns a string.
        "recording";

    const storage = await createUserStorageProvider(authn.user.id);
    await storage.uploadFile(storageKey, buffer, contentType);

    const now = new Date();
    const endTime = new Date(now.getTime() + durationMs);

    try {
        const [inserted] = await db
            .insert(recordings)
            .values({
                userId: authn.user.id,
                deviceSn: "api",
                plaudFileId: fileId,
                filename: encryptText(basename),
                duration: durationMs,
                startTime: now,
                endTime,
                filesize: buffer.length,
                fileMd5: md5,
                storageType: env.DEFAULT_STORAGE_TYPE,
                storagePath: storageKey,
                downloadedAt: now,
                plaudVersion: "1",
                isTrash: false,
                externalId: externalId ?? null,
                context: contextField ? encryptText(contextField) : null,
            })
            .returning();

        // Fire-and-forget transcribe worker. We can't `await` it here
        // because a real meeting transcript on CPU Whisper runs an
        // hour+ — the HTTP response would time out long before the
        // worker finishes, and the caller (meets etc.) only needs the
        // `recording.id` + `external_id` correlation handle from this
        // response anyway. Completion arrives via the
        // `transcription.completed` webhook subscription. A bare
        // .catch keeps an unhandled-rejection from killing the
        // process; `transcribeRecording` already handles errors
        // internally and emits `transcription.failed` itself.
        if (autoTranscribe) {
            void transcribeRecording(authn.user.id, inserted.id).catch(
                (err: unknown) => {
                    console.error(
                        "Auto-transcribe trigger failed for",
                        inserted.id,
                        err,
                    );
                },
            );
        }

        return NextResponse.json(
            serializeRecording(inserted, null, null, null),
            { status: 201 },
        );
    } catch (dbError) {
        // Clean up the blob we just wrote — without this the next retry
        // would resurrect a half-created row by external_id and there
        // would be an unreferenced object sitting in storage forever.
        try {
            await storage.deleteFile(storageKey);
        } catch (cleanupErr) {
            console.error(
                "Failed to clean up orphaned storage file after DB insert error:",
                cleanupErr,
            );
        }
        throw dbError;
    }
});
