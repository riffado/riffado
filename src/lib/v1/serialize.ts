import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudDevices,
    recordings,
    transcriptions,
} from "@/db/schema";
import { decryptJsonField, decryptText } from "@/lib/encryption/fields";

type RecordingRow = typeof recordings.$inferSelect;
type DeviceRow = typeof plaudDevices.$inferSelect;
type TranscriptionRow = typeof transcriptions.$inferSelect;
type AiEnhancementRow = typeof aiEnhancements.$inferSelect;

export type RecordingCursor = {
    updatedAt: Date;
    id: string;
};

export type V1Transcript = {
    language: string | null;
    text: string;
    provider: string;
    model: string;
    created_at: string;
};

export type V1Summary = {
    text: string | null;
    action_items: string[] | null;
    key_points: string[] | null;
    provider: string;
    model: string;
    created_at: string;
};

export type V1Recording = {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    recorded_at: string;
    duration_ms: number;
    filesize_bytes: number;
    device: {
        serial_number: string;
        name: string | null;
        model: string | null;
    } | null;
    has_transcription: boolean;
    has_summary: boolean;
    /**
     * True while a `transcribeRecording` worker holds an active claim on
     * this row. Lets the dashboard show a persistent "Transcribing..."
     * chip across browser reloads — without this the chip only existed
     * as client React state and was lost on reload, which is why users
     * could trigger duplicate runs by clicking again. Derived from
     * `recordings.transcribing_started_at` + stale-timeout.
     */
    transcription_in_progress: boolean;
    links: {
        self: string;
        transcript: string;
        audio: string;
    };
};

/**
 * Mirrors `TRANSCRIPTION_STALE_TIMEOUT_MS` in `transcribe-recording.ts`.
 * Defined here as well (rather than imported) because the serializer
 * runs in contexts that should not pull in the OpenAI SDK and storage
 * drivers transitively from the worker module. Keep these two in sync.
 */
const TRANSCRIPTION_STALE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export type V1RecordingDetail = V1Recording & {
    transcript: V1Transcript | null;
    summary: V1Summary | null;
};

function toIso(value: Date): string {
    return value.toISOString();
}

function stringArrayOrNull(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const strings = value.filter((item): item is string => {
        return typeof item === "string";
    });
    return strings.length > 0 ? strings : [];
}

export function encodeRecordingCursor(cursor: RecordingCursor): string {
    return Buffer.from(
        JSON.stringify({
            updatedAt: toIso(cursor.updatedAt),
            id: cursor.id,
        }),
    ).toString("base64url");
}

export function decodeRecordingCursor(cursor: string): RecordingCursor | null {
    try {
        const raw = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8"),
        ) as unknown;
        if (!raw || typeof raw !== "object") return null;

        const payload = raw as Record<string, unknown>;
        if (
            typeof payload.updatedAt !== "string" ||
            typeof payload.id !== "string"
        ) {
            return null;
        }

        const updatedAt = new Date(payload.updatedAt);
        if (Number.isNaN(updatedAt.getTime()) || !payload.id) return null;

        return { updatedAt, id: payload.id };
    } catch {
        return null;
    }
}

export function serializeTranscript(
    transcription: TranscriptionRow | null,
): V1Transcript | null {
    if (!transcription) return null;

    return {
        language: transcription.detectedLanguage,
        text: decryptText(transcription.text),
        provider: transcription.provider,
        model: transcription.model,
        created_at: toIso(transcription.createdAt),
    };
}

export function serializeSummary(
    enhancement: AiEnhancementRow | null,
): V1Summary | null {
    if (!enhancement) return null;
    const actionItems = decryptJsonField<unknown>(enhancement.actionItems);
    const keyPoints = decryptJsonField<unknown>(enhancement.keyPoints);

    return {
        text: decryptText(enhancement.summary) ?? null,
        action_items: stringArrayOrNull(actionItems),
        key_points: stringArrayOrNull(keyPoints),
        provider: enhancement.provider,
        model: enhancement.model,
        created_at: toIso(enhancement.createdAt),
    };
}

export function serializeRecording(
    recording: RecordingRow,
    device: DeviceRow | null,
    transcription: TranscriptionRow | null,
    enhancement: AiEnhancementRow | null,
): V1Recording {
    const self = `/api/v1/recordings/${recording.id}`;

    const claimAt = recording.transcribingStartedAt;
    const transcriptionInProgress = Boolean(
        claimAt &&
            Date.now() - claimAt.getTime() < TRANSCRIPTION_STALE_TIMEOUT_MS,
    );

    return {
        id: recording.id,
        title: decryptText(recording.filename),
        created_at: toIso(recording.createdAt),
        updated_at: toIso(recording.updatedAt),
        recorded_at: toIso(recording.startTime),
        duration_ms: recording.duration,
        filesize_bytes: recording.filesize,
        device: device
            ? {
                  serial_number: device.serialNumber,
                  name: device.name,
                  model: device.model,
              }
            : null,
        has_transcription: Boolean(transcription),
        has_summary: Boolean(enhancement),
        transcription_in_progress: transcriptionInProgress,
        links: {
            self,
            transcript: `${self}/transcript`,
            audio: `${self}/audio`,
        },
    };
}

export function serializeRecordingDetail(
    recording: RecordingRow,
    device: DeviceRow | null,
    transcription: TranscriptionRow | null,
    enhancement: AiEnhancementRow | null,
): V1RecordingDetail {
    return {
        ...serializeRecording(recording, device, transcription, enhancement),
        transcript: serializeTranscript(transcription),
        summary: serializeSummary(enhancement),
    };
}

export async function getV1RecordingDetailForUser(
    userId: string,
    recordingId: string,
): Promise<V1RecordingDetail | null> {
    const [row] = await db
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
                eq(plaudDevices.userId, userId),
                eq(plaudDevices.serialNumber, recordings.deviceSn),
            ),
        )
        .leftJoin(
            transcriptions,
            and(
                eq(transcriptions.recordingId, recordings.id),
                eq(transcriptions.userId, userId),
            ),
        )
        .leftJoin(
            aiEnhancements,
            and(
                eq(aiEnhancements.recordingId, recordings.id),
                eq(aiEnhancements.userId, userId),
            ),
        )
        .where(
            and(
                eq(recordings.id, recordingId),
                eq(recordings.userId, userId),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!row) return null;

    return serializeRecordingDetail(
        row.recording,
        row.device,
        row.transcription,
        row.enhancement,
    );
}
