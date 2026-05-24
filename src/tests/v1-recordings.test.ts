import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string | null | undefined) =>
        typeof value === "string" ? value.replace(/^encrypted:/, "") : value,
    ),
    decryptJsonField: vi.fn((value: unknown) => value ?? null),
}));

import {
    decodeRecordingCursor,
    encodeRecordingCursor,
    serializeRecording,
    serializeRecordingDetail,
} from "@/lib/v1/serialize";

const now = new Date("2026-05-06T12:00:00.000Z");

const recording = {
    id: "rec-1",
    userId: "user-1",
    deviceSn: "SN-1",
    plaudFileId: "plaud-1",
    filename: "encrypted:Planning Call",
    duration: 120000,
    startTime: new Date("2026-05-06T11:00:00.000Z"),
    endTime: new Date("2026-05-06T11:02:00.000Z"),
    filesize: 12345,
    fileMd5: "abc",
    storageType: "local",
    storagePath: "user-1/rec.mp3",
    downloadedAt: now,
    plaudVersion: "1",
    timezone: null,
    zonemins: null,
    scene: null,
    isTrash: false,
    waveformPeaks: null,
    externalId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
};

const device = {
    id: "device-1",
    userId: "user-1",
    serialNumber: "SN-1",
    name: "Plaud Note",
    model: "Note",
    versionNumber: null,
    createdAt: now,
    updatedAt: now,
};

const transcription = {
    id: "tr-1",
    recordingId: "rec-1",
    userId: "user-1",
    text: "encrypted:Hello world",
    detectedLanguage: "en",
    transcriptionType: "server",
    provider: "openai",
    model: "whisper-1",
    createdAt: now,
};

const enhancement = {
    id: "sum-1",
    recordingId: "rec-1",
    userId: "user-1",
    summary: "encrypted:A short summary",
    actionItems: ["Follow up"],
    keyPoints: ["Planning"],
    provider: "openai",
    model: "gpt-4o-mini",
    createdAt: now,
};

describe("v1 recordings", () => {
    it("round-trips recording cursors", () => {
        const cursor = encodeRecordingCursor({ updatedAt: now, id: "rec-1" });
        expect(decodeRecordingCursor(cursor)).toEqual({
            updatedAt: now,
            id: "rec-1",
        });
        expect(decodeRecordingCursor("not-base64-json")).toBeNull();
    });

    it("serializes stable list payloads", () => {
        expect(
            serializeRecording(recording, device, transcription, enhancement),
        ).toEqual({
            id: "rec-1",
            title: "Planning Call",
            external_id: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            recorded_at: "2026-05-06T11:00:00.000Z",
            duration_ms: 120000,
            filesize_bytes: 12345,
            device: {
                serial_number: "SN-1",
                name: "Plaud Note",
                model: "Note",
            },
            has_transcription: true,
            has_summary: true,
            links: {
                self: "/api/v1/recordings/rec-1",
                transcript: "/api/v1/recordings/rec-1/transcript",
                audio: "/api/v1/recordings/rec-1/audio",
            },
        });
    });

    it("inlines transcript and summary for detail payloads", () => {
        const detail = serializeRecordingDetail(
            recording,
            device,
            transcription,
            enhancement,
        );

        expect(detail.transcript?.text).toBe("Hello world");
        expect(detail.summary?.text).toBe("A short summary");
        expect(detail.summary?.action_items).toEqual(["Follow up"]);
        expect(detail.summary?.key_points).toEqual(["Planning"]);
    });

    it("keeps legacy plaintext rows readable through the same serializers", () => {
        const detail = serializeRecordingDetail(
            { ...recording, filename: "Legacy Recording" },
            null,
            { ...transcription, text: "Legacy transcript" },
            null,
        );

        expect(detail.title).toBe("Legacy Recording");
        expect(detail.transcript?.text).toBe("Legacy transcript");
    });

    it("round-trips external_id when set so webhook receivers can correlate", () => {
        const row = { ...recording, externalId: "MR-2026-05-24-001" };
        expect(serializeRecording(row, null, null, null).external_id).toBe(
            "MR-2026-05-24-001",
        );
    });
});
