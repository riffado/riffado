/**
 * Pins the cheap filetag reconciliation on the `version_ms`-unchanged
 * path of the recording sync: folder moves made in the official Plaud
 * app may not bump `version_ms`, so the sync must update `filetagId`
 * without re-downloading the audio — and must never clear a local-only
 * assignment.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
    }),
}));

vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/hosted/billing/storage-cap", () => ({
    enforceStorageCap: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/lib/sync/sync-filetags", () => ({
    syncFiletagsForUser: vi.fn(),
}));

import { createPlaudClient } from "@/lib/plaud/client-factory";
import { syncFiletagsForUser } from "@/lib/sync/sync-filetags";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import { emitEvent } from "@/lib/webhooks/emit";
import { captureUpdates, queueSelects } from "./helpers/drizzle-mocks";

const USER_ID = "user-reconcile";

function connectionRow() {
    return {
        id: "conn-1",
        userId: USER_ID,
        bearerToken: "enc-token",
        apiBase: "https://api.plaud.ai",
        workspaceId: "ws-1",
    };
}

function wirePlaudClient(plaudRecording: Record<string, unknown>): {
    downloadRecording: Mock;
} {
    const downloadRecording = vi.fn();
    (createPlaudClient as Mock).mockResolvedValue({
        getRecordings: vi.fn().mockResolvedValue({
            data_file_list: [plaudRecording],
        }),
        downloadRecording,
        workspaceId: "ws-1",
        usingUserTokenFallback: false,
    });
    return { downloadRecording };
}

describe("recording sync filetag reconciliation (version unchanged)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("updates only filetagId without re-downloading audio", async () => {
        (syncFiletagsForUser as Mock).mockResolvedValue({
            map: new Map([["9", "local-tag-1"]]),
            localOnlyTagIds: new Set<string>(),
        });

        // Select order: 1 connection, 2 settings, 3 users, 4 existing recording.
        queueSelects([
            [connectionRow()],
            [],
            [],
            [
                {
                    id: "rec-1",
                    userId: USER_ID,
                    plaudFileId: "plaud-file-1",
                    plaudVersion: "1000",
                    filetagId: null,
                    deletedAt: null,
                },
            ],
        ]);
        const updates = captureUpdates();
        const { downloadRecording } = wirePlaudClient({
            id: "plaud-file-1",
            filename: "Test",
            version_ms: 1000,
            filetag_id_list: ["9"],
        });

        const result = await syncRecordingsForUser(USER_ID);

        expect(result.errors).toEqual([]);
        expect(downloadRecording).not.toHaveBeenCalled();
        const filetagUpdate = updates.find((u) => "filetagId" in u);
        expect(filetagUpdate?.filetagId).toBe("local-tag-1");
        expect(result.newRecordings).toBe(0);
        expect(result.updatedRecordings).toBe(0);
        // Webhook/incremental consumers must learn about the move.
        expect(emitEvent).toHaveBeenCalledWith(
            "recording.updated",
            USER_ID,
            "rec-1",
        );
    });

    it("preserves local-only assignments instead of clearing them", async () => {
        (syncFiletagsForUser as Mock).mockResolvedValue({
            map: new Map<string, string>(),
            localOnlyTagIds: new Set(["local-only-tag"]),
        });

        queueSelects([
            [connectionRow()],
            [],
            [],
            [
                {
                    id: "rec-1",
                    userId: USER_ID,
                    plaudFileId: "plaud-file-1",
                    plaudVersion: "1000",
                    filetagId: "local-only-tag",
                    deletedAt: null,
                },
            ],
        ]);
        const updates = captureUpdates();
        wirePlaudClient({
            id: "plaud-file-1",
            filename: "Test",
            version_ms: 1000,
            filetag_id_list: [],
        });

        const result = await syncRecordingsForUser(USER_ID);

        expect(result.errors).toEqual([]);
        expect(updates.find((u) => "filetagId" in u)).toBeUndefined();
        expect(emitEvent).not.toHaveBeenCalled();
    });

    it("leaves tombstoned rows untouched even when the assignment differs", async () => {
        (syncFiletagsForUser as Mock).mockResolvedValue({
            map: new Map([["9", "local-tag-1"]]),
            localOnlyTagIds: new Set<string>(),
        });

        queueSelects([
            [connectionRow()],
            [],
            [],
            [
                {
                    id: "rec-1",
                    userId: USER_ID,
                    plaudFileId: "plaud-file-1",
                    plaudVersion: "1000",
                    filetagId: null,
                    deletedAt: new Date(),
                },
            ],
        ]);
        const updates = captureUpdates();
        const { downloadRecording } = wirePlaudClient({
            id: "plaud-file-1",
            filename: "Test",
            version_ms: 1000,
            filetag_id_list: ["9"],
        });

        const result = await syncRecordingsForUser(USER_ID);

        expect(result.errors).toEqual([]);
        expect(downloadRecording).not.toHaveBeenCalled();
        expect(updates.find((u) => "filetagId" in u)).toBeUndefined();
        expect(emitEvent).not.toHaveBeenCalled();
    });
});
