export type StoredWebhookPayload = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function createStoredWebhookPayload(
    event: string,
    recordingId: string,
    options: { deliveredAt?: Date; error?: string } = {},
): StoredWebhookPayload {
    const payload: StoredWebhookPayload = {
        event,
        delivered_at: (options.deliveredAt ?? new Date()).toISOString(),
        recording_id: recordingId,
    };

    if (options.error) {
        payload.error = { message: options.error };
    }

    return payload;
}

export function createRedactedWebhookPayload(
    recordingId: string,
    redactedAt = new Date(),
): StoredWebhookPayload {
    return {
        recording_id: recordingId,
        redacted: true,
        redacted_at: redactedAt.toISOString(),
    };
}

export function createUnavailableWebhookPayload(
    recordingId: string | null,
    reason: string,
    redactedAt = new Date(),
): StoredWebhookPayload {
    return {
        recording_id: recordingId,
        redacted: true,
        redacted_at: redactedAt.toISOString(),
        error: { message: reason },
    };
}

export function getWebhookPayloadRecordingId(payload: unknown): string | null {
    const record = asRecord(payload);
    if (!record) return null;

    if (typeof record.recording_id === "string" && record.recording_id.trim()) {
        return record.recording_id;
    }

    const data = asRecord(record.data);
    if (typeof data?.id === "string" && data.id.trim()) {
        return data.id;
    }

    return null;
}

export function getWebhookPayloadDeliveredAt(
    payload: unknown,
    fallback: Date,
): Date {
    const record = asRecord(payload);
    if (typeof record?.delivered_at !== "string") return fallback;

    const deliveredAt = new Date(record.delivered_at);
    if (Number.isNaN(deliveredAt.getTime())) return fallback;
    return deliveredAt;
}

export function getWebhookPayloadError(payload: unknown): string | null {
    const record = asRecord(payload);
    const error = asRecord(record?.error);
    if (typeof error?.message !== "string" || !error.message.trim()) {
        return null;
    }
    return error.message;
}

export function createOutboundWebhookPayload(
    event: string,
    deliveredAt: Date,
    recording: unknown,
    error: string | null,
): StoredWebhookPayload {
    const payload: StoredWebhookPayload = {
        event,
        delivered_at: deliveredAt.toISOString(),
        data: recording,
    };

    if (error) {
        payload.error = { message: error };
    }

    return payload;
}
