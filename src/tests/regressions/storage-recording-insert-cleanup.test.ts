/**
 * Regression: an upload that finished while its account was being
 * deleted left its audio in storage.
 *
 * `deleteUser` now locks the user row before it collects storage keys,
 * so a recording insert that races the deletion waits and then fails on
 * the user FK. The writer must then remove the object it uploaded:
 * Plaud sync deletes it on an FK violation (other insert failures keep
 * it, since the deterministic key may belong to a concurrent sync's
 * row), the upload route deletes it on any insert failure (its key is
 * unique to the request), and a delete that fails is queued in
 * `storage_deletion_queue` instead of only being logged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
    storage: {
        uploadFile: vi.fn(),
        deleteFile: vi.fn(),
    },
    enqueueStorageDeletions: vi.fn(),
    plaudClient: {
        getRecordings: vi.fn(),
        hydrateRecording: vi.fn(async (r: unknown) => r),
        downloadRecording: vi.fn(),
        workspaceId: null,
    },
}));

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/queries/storage-deletions", () => ({
    enqueueStorageDeletions: mocks.enqueueStorageDeletions,
}));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn(async () => mocks.storage),
}));
vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(async () => mocks.plaudClient),
}));
vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn(async () => false),
}));
vi.mock("@/lib/hosted/billing/storage-cap", () => ({
    enforceStorageCap: vi.fn(async () => ({
        allowed: true,
        currentBytes: 0,
        limitBytes: null,
    })),
}));
vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn(),
}));
vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn(),
}));
vi.mock("@/lib/webhooks/emit", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));
vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("music-metadata", () => ({
    parseBuffer: vi.fn(async () => ({ format: { duration: 12 } })),
}));

import { POST as uploadRecording } from "@/app/api/recordings/upload/route";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

const plaudRecording = {
    id: "plaud-1",
    filename: "Recording 1.mp3",
    duration: 60000,
    start_time: "2024-01-01T10:00:00Z",
    end_time: "2024-01-01T10:01:00Z",
    filesize: 1024,
    file_md5: "abc123",
    serial_number: "SN123",
    version_ms: 1000,
    timezone: 0,
    zonemins: 0,
    scene: 0,
    is_trash: false,
};

function pgError(code: string): Error {
    return new Error("Failed query: insert into recordings", {
        cause: Object.assign(new Error("violates constraint"), { code }),
    });
}

function selectReturning(...results: unknown[][]) {
    for (const result of results) {
        mocks.db.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(result),
                }),
            }),
        });
    }
}

function syncInsertRejecting(error: Error) {
    mocks.db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(error),
        }),
    });
}

function uploadInsertRejecting(error: Error) {
    mocks.db.insert.mockReturnValue({
        values: vi.fn(() => Promise.reject(error)),
    });
}

async function syncOneNewRecording(): Promise<string[]> {
    selectReturning(
        [{ id: "conn-1", userId: "user-1", bearerToken: "t" }],
        [{ id: "settings-1" }],
        [{ email: "u@example.com", suspendedAt: null }],
        [],
        [],
    );
    const result = await syncRecordingsForUser("user-1");
    return result.errors;
}

describe("recording insert failure cleanup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.db.select.mockReset();
        mocks.db.update.mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        mocks.storage.uploadFile.mockResolvedValue("ok");
        mocks.storage.deleteFile.mockResolvedValue(undefined);
        mocks.enqueueStorageDeletions.mockResolvedValue(undefined);
        mocks.plaudClient.getRecordings.mockResolvedValue({
            data_file_list: [plaudRecording],
        });
        mocks.plaudClient.downloadRecording.mockResolvedValue(
            Buffer.from("audio"),
        );
    });

    it("sync deletes the uploaded audio when the insert fails because the user is gone", async () => {
        syncInsertRejecting(pgError("23503"));

        const errors = await syncOneNewRecording();

        expect(errors).toHaveLength(1);
        const [uploadedKey] = mocks.storage.uploadFile.mock.calls[0];
        expect(uploadedKey).toMatch(/^user-1\/plaud-1\./);
        expect(mocks.storage.deleteFile).toHaveBeenCalledWith(uploadedKey);
        expect(mocks.enqueueStorageDeletions).not.toHaveBeenCalled();
    });

    it("sync queues the uploaded audio when deleting it after an FK failure fails", async () => {
        syncInsertRejecting(pgError("23503"));
        mocks.storage.deleteFile.mockRejectedValue(new Error("S3 503"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await syncOneNewRecording();
        warn.mockRestore();

        const [uploadedKey] = mocks.storage.uploadFile.mock.calls[0];
        expect(mocks.enqueueStorageDeletions).toHaveBeenCalledWith(
            [uploadedKey],
            "recording_cleanup",
        );
    });

    it("sync keeps the audio when the insert lost a race to a concurrent sync of the same file", async () => {
        syncInsertRejecting(pgError("23505"));

        await syncOneNewRecording();

        expect(mocks.storage.uploadFile).toHaveBeenCalledTimes(1);
        expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
        expect(mocks.enqueueStorageDeletions).not.toHaveBeenCalled();
    });

    function uploadRequest(): Request {
        const form = new FormData();
        form.append(
            "file",
            new File([Buffer.from("audio-bytes")], "memo.mp3", {
                type: "audio/mpeg",
            }),
        );
        return new Request("http://localhost/api/recordings/upload", {
            method: "POST",
            body: form,
        });
    }

    it("upload queues the uploaded audio when the insert fails and so does the delete", async () => {
        uploadInsertRejecting(pgError("23503"));
        mocks.storage.deleteFile.mockRejectedValue(new Error("S3 503"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await uploadRecording(uploadRequest());
        warn.mockRestore();
        error.mockRestore();

        expect(response.status).toBe(500);
        const [uploadedKey] = mocks.storage.uploadFile.mock.calls[0];
        expect(uploadedKey).toMatch(/^user-1\/uploaded-.+\.mp3$/);
        expect(mocks.storage.deleteFile).toHaveBeenCalledWith(uploadedKey);
        expect(mocks.enqueueStorageDeletions).toHaveBeenCalledWith(
            [uploadedKey],
            "recording_cleanup",
        );
    });

    it("upload does not queue audio it deleted", async () => {
        uploadInsertRejecting(pgError("23503"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await uploadRecording(uploadRequest());
        error.mockRestore();

        expect(mocks.storage.deleteFile).toHaveBeenCalledTimes(1);
        expect(mocks.enqueueStorageDeletions).not.toHaveBeenCalled();
    });
});
