import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { plaudDevices, recordings } from "@/db/schema";
import { env } from "@/lib/env";
import {
    getV1RecordingDetailForUser,
    serializeRecordingDetail,
    type V1RecordingDetail,
    type V1Transcript,
} from "@/lib/v1/serialize";

const TRANSCRIPT_PREVIEW_CHARS = 500;

type WebhookTranscript = Omit<V1Transcript, "text"> & {
    preview: string;
    truncated: boolean;
    length: number;
};

type WebhookRecordingDetail = Omit<
    V1RecordingDetail,
    "transcript" | "transcripts"
> & {
    api_url: string;
    links: V1RecordingDetail["links"];
    transcript: WebhookTranscript | null;
    deleted_at?: string;
};

function absoluteApiUrl(path: string): string {
    return new URL(path, env.APP_URL).toString();
}

function serializeWebhookTranscript(
    transcript: V1Transcript | null,
): WebhookTranscript | null {
    if (!transcript) return null;
    const text = transcript.text;

    return {
        source: transcript.source,
        preview: text.slice(0, TRANSCRIPT_PREVIEW_CHARS),
        truncated: text.length > TRANSCRIPT_PREVIEW_CHARS,
        length: text.length,
        language: transcript.language,
        provider: transcript.provider,
        model: transcript.model,
        created_at: transcript.created_at,
    };
}

function serializeWebhookRecording(
    recording: V1RecordingDetail,
    deletedAt?: Date,
): WebhookRecordingDetail {
    const links = {
        self: absoluteApiUrl(recording.links.self),
        transcript: absoluteApiUrl(recording.links.transcript),
        audio: absoluteApiUrl(recording.links.audio),
    };

    // `transcript` is replaced with a truncated preview below, and the full
    // `transcripts[]` array is dropped entirely — webhooks never carry full
    // transcript text. Both are destructured out of the spread base.
    const { transcript, transcripts, ...base } = recording;
    const payload: WebhookRecordingDetail = {
        ...base,
        api_url: links.self,
        links,
        transcript: serializeWebhookTranscript(transcript),
    };
    void transcripts;

    if (deletedAt) {
        payload.deleted_at = deletedAt.toISOString();
        payload.transcript = null;
        payload.summary = null;
    }

    return payload;
}

// recording.deleted hydration depends on soft-delete tombstones.
async function getDeletedWebhookRecordingDetailForUser(
    userId: string,
    recordingId: string,
): Promise<WebhookRecordingDetail | null> {
    const [row] = await db
        .select({
            recording: recordings,
            device: plaudDevices,
        })
        .from(recordings)
        .leftJoin(
            plaudDevices,
            and(
                eq(plaudDevices.userId, userId),
                eq(plaudDevices.serialNumber, recordings.deviceSn),
            ),
        )
        .where(
            and(
                eq(recordings.id, recordingId),
                eq(recordings.userId, userId),
                isNotNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!row?.recording.deletedAt) return null;

    return serializeWebhookRecording(
        serializeRecordingDetail(row.recording, row.device, [], null),
        row.recording.deletedAt,
    );
}

export async function getWebhookRecordingDetailForUser(
    userId: string,
    recordingId: string,
    event: string,
): Promise<WebhookRecordingDetail | null> {
    if (event === "recording.deleted") {
        return getDeletedWebhookRecordingDetailForUser(userId, recordingId);
    }

    const recording = await getV1RecordingDetailForUser(userId, recordingId);
    if (!recording) return null;

    return serializeWebhookRecording(recording);
}
