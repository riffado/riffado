import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/** Matches `speaker_names.speaker_label` (varchar(50)). */
export const MAX_SPEAKER_LABEL_LENGTH = 50;
export const MAX_DISPLAY_NAME_LENGTH = 200;
/** Upper bound on labels accepted by a single match request. */
export const MAX_SPEAKERS_PER_MATCH = 64;

/** Wrap a validation `Error` as a 400 with a client-safe message. */
export function speakerInputError(error: unknown): AppError {
    return new AppError(
        ErrorCode.INVALID_INPUT,
        error instanceof Error ? error.message : "Invalid speaker payload",
        400,
    );
}

/**
 * Diarization labels as the transcript renderer recognises them
 * ("SPEAKER_00", "Speaker 1"). Anchored to start with an alphanumeric so
 * a payload can never smuggle in a key like `__proto__`, which would
 * poison the label-keyed maps the client builds.
 */
const SPEAKER_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;

export function parseSpeakerLabel(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("speakerLabel is required");
    }
    const label = value.trim();
    if (label.length > MAX_SPEAKER_LABEL_LENGTH) {
        throw new Error(
            `speakerLabel must be at most ${MAX_SPEAKER_LABEL_LENGTH} characters`,
        );
    }
    if (!SPEAKER_LABEL_RE.test(label)) {
        throw new Error(
            "speakerLabel may only contain letters, digits, spaces, and . _ ' -",
        );
    }
    return label;
}

export function parseDisplayName(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("displayName is required");
    }
    const name = value.trim();
    if (name.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new Error(
            `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
        );
    }
    return name;
}

/**
 * Confirm the recording exists, belongs to `userId`, and is not
 * tombstoned. Every speaker route calls this before touching
 * `speaker_names` so a recording id from the URL can never reach another
 * user's rows.
 *
 * @throws AppError 404 when the recording is not the caller's.
 */
export async function assertRecordingOwned(
    recordingId: string,
    userId: string,
): Promise<void> {
    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, recordingId),
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
}
