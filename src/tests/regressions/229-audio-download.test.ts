/**
 * Regression tests for issue #229:
 *   Download the original audio file from the web app via
 *   GET /api/recordings/[id]/audio?download=1
 *
 * Covers:
 *   1. Authenticated download sets Content-Disposition (title + storage ext)
 *   2. Playback (no download param) does not set Content-Disposition
 *   3. Download ignores Range and returns the full file
 *   4. 404 for another user's recording / missing row
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
    captureServerEvent: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({
        user: { id: "user-1" },
    }),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string | null | undefined) =>
        typeof value === "string" ? value.replace(/^encrypted:/, "") : value,
    ),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-bytes")),
    }),
}));

import { GET as getAudio } from "@/app/api/recordings/[id]/audio/route";
import { db } from "@/db";
import { requireApiSession } from "@/lib/auth-server";
import { ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";

const now = new Date("2026-05-06T12:00:00.000Z");
const audioBytes = Buffer.from("audio-bytes");

function recordingRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "rec-1",
        userId: "user-1",
        deviceSn: "SN-1",
        plaudFileId: "plaud-1",
        filename: "encrypted:Planning Call",
        duration: 120000,
        startTime: now,
        endTime: now,
        filesize: audioBytes.length,
        fileMd5: "abc",
        storageType: "local",
        storagePath: "user-1/rec.mp3",
        downloadedAt: now,
        plaudVersion: "1",
        timezone: null,
        zonemins: null,
        scene: null,
        isTrash: false,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function selectRecording(row: unknown) {
    (db.select as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(row ? [row] : []),
            }),
        }),
    });
}

function routeParams(id = "rec-1") {
    return { params: Promise.resolve({ id }) };
}

describe("GET /api/recordings/[id]/audio?download=1", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (requireApiSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
        (createUserStorageProvider as Mock).mockResolvedValue({
            downloadFile: vi.fn().mockResolvedValue(audioBytes),
        });
    });

    it("returns the original file as an attachment named from the title", async () => {
        selectRecording(recordingRow());

        const response = await getAudio(
            new Request(
                "http://localhost/api/recordings/rec-1/audio?download=1",
            ),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
        expect(response.headers.get("Content-Disposition")).toContain(
            "attachment",
        );
        expect(response.headers.get("Content-Disposition")).toContain(
            "Planning Call.mp3",
        );
        expect(await response.text()).toBe("audio-bytes");
    });

    it("uses the storage-path extension for non-mp3 originals", async () => {
        selectRecording(recordingRow({ storagePath: "user-1/interview.m4a" }));

        const response = await getAudio(
            new Request(
                "http://localhost/api/recordings/rec-1/audio?download=1",
            ),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("audio/mp4");
        expect(response.headers.get("Content-Disposition")).toContain(
            "Planning Call.m4a",
        );
    });

    it("does not set Content-Disposition for in-app playback", async () => {
        selectRecording(recordingRow());

        const response = await getAudio(
            new Request("http://localhost/api/recordings/rec-1/audio"),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Disposition")).toBeNull();
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    });

    it("ignores Range on download so the saved file is complete", async () => {
        selectRecording(recordingRow());

        const response = await getAudio(
            new Request(
                "http://localhost/api/recordings/rec-1/audio?download=1",
                { headers: { Range: "bytes=0-3" } },
            ),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("audio-bytes");
        expect(response.headers.get("Content-Range")).toBeNull();
    });

    it("returns 404 for another user's recording", async () => {
        selectRecording(null);

        const response = await getAudio(
            new Request(
                "http://localhost/api/recordings/rec-1/audio?download=1",
            ),
            routeParams(),
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            code: ErrorCode.RECORDING_NOT_FOUND,
        });
        expect(createUserStorageProvider).not.toHaveBeenCalled();
    });
});
