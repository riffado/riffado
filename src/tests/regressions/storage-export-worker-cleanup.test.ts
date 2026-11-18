/**
 * Regression: the export worker dropped failed deletes of its own
 * attempt objects (`deleteFile(...).catch(() => {})`) and, on local
 * storage, retried an already-missing archive forever because a missing
 * file made `deleteFile` reject.
 *
 * After the fix, a failed delete of an attempt's object is queued in
 * `storage_deletion_queue`, a missing object counts as deleted in the
 * expired-archive and stale-key sweeps, and every tick also retries the
 * deletion queue.
 *
 * A failure reported after the job's completion had already committed
 * (e.g. the connection dropped after COMMIT) used to requeue the
 * completed job and delete its archive. The failure write now only
 * matches a `processing` job, completion clears the claim token, and the
 * worker keeps an attempt's object whenever the job row references it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    db: { select: vi.fn() },
    queries: {
        claimPendingExportJobs: vi.fn(),
        selectExpiredExportJobs: vi.fn(),
        deleteExportJobRow: vi.fn(),
        completeExportJob: vi.fn(),
        recordExportJobFailure: vi.fn(),
        reclaimStaleProcessingExportJobs: vi.fn(),
        selectStaleStorageKeys: vi.fn(),
        clearStaleStorageKey: vi.fn(),
        isExportArchiveReferenced: vi.fn(),
        EXPORT_MAX_ATTEMPTS: 3,
    },
    storageDeletions: { enqueueStorageDeletions: vi.fn() },
    deletionQueue: { sweepStorageDeletionQueue: vi.fn() },
    buildArchive: { buildAndUploadExportArchive: vi.fn() },
    email: { sendExportReadyEmail: vi.fn() },
    storage: { deleteFile: vi.fn() },
}));

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/db/queries/export-jobs", () => mocks.queries);
vi.mock("@/db/queries/storage-deletions", () => mocks.storageDeletions);
vi.mock("@/lib/storage/deletion-queue", () => mocks.deletionQueue);
vi.mock("@/lib/export/build-archive", () => mocks.buildArchive);
vi.mock("@/lib/notifications/email", () => mocks.email);
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.example.com" } }));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: vi.fn() }));
vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => mocks.storage,
}));

import { tick } from "@/lib/export/worker";

function enoent(): Error {
    return new Error("Failed to delete file from local storage", {
        cause: Object.assign(new Error("ENOENT: no such file"), {
            code: "ENOENT",
        }),
    });
}

describe("export worker storage cleanup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.queries.reclaimStaleProcessingExportJobs.mockResolvedValue(0);
        mocks.queries.claimPendingExportJobs.mockResolvedValue([]);
        mocks.queries.selectExpiredExportJobs.mockResolvedValue([]);
        mocks.queries.selectStaleStorageKeys.mockResolvedValue([]);
        mocks.queries.deleteExportJobRow.mockResolvedValue(undefined);
        mocks.queries.clearStaleStorageKey.mockResolvedValue(undefined);
        mocks.queries.recordExportJobFailure.mockResolvedValue({
            status: "pending",
            attempts: 1,
        });
        mocks.storageDeletions.enqueueStorageDeletions.mockResolvedValue(
            undefined,
        );
        mocks.deletionQueue.sweepStorageDeletionQueue.mockResolvedValue({
            deleted: 0,
            retrying: 0,
            failed: 0,
        });
        mocks.storage.deleteFile.mockResolvedValue(undefined);
    });

    it("queues the attempt object for retry when deleting it after a failed build fails", async () => {
        mocks.queries.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1", claimToken: "token-1" },
        ]);
        mocks.buildArchive.buildAndUploadExportArchive.mockRejectedValue(
            new Error("upload interrupted"),
        );
        mocks.storage.deleteFile.mockRejectedValue(new Error("S3 503"));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();
        warnSpy.mockRestore();

        expect(
            mocks.storageDeletions.enqueueStorageDeletions,
        ).toHaveBeenCalledWith(
            ["exports/user-1/job-1-token-1.zip"],
            "export_cleanup",
        );
    });

    it("queues a superseded claim's finished archive when its delete fails", async () => {
        mocks.queries.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1", claimToken: "old" },
        ]);
        mocks.buildArchive.buildAndUploadExportArchive.mockResolvedValue({
            recordingCount: 1,
            fileSize: 10,
        });
        mocks.queries.completeExportJob.mockResolvedValue(false);
        mocks.storage.deleteFile.mockRejectedValue(new Error("S3 503"));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();
        warnSpy.mockRestore();

        expect(mocks.queries.completeExportJob).toHaveBeenCalledWith(
            expect.objectContaining({ jobId: "job-1", userId: "user-1" }),
        );
        expect(
            mocks.storageDeletions.enqueueStorageDeletions,
        ).toHaveBeenCalledWith(
            ["exports/user-1/job-1-old.zip"],
            "export_cleanup",
        );
    });

    it("deletes the row of an expired archive whose object is already gone", async () => {
        mocks.queries.selectExpiredExportJobs.mockResolvedValue([
            { id: "job-old", storageKey: "exports/u/job-old.zip" },
        ]);
        mocks.storage.deleteFile.mockRejectedValue(enoent());

        await tick();

        expect(mocks.queries.deleteExportJobRow).toHaveBeenCalledWith(
            "job-old",
        );
    });

    it("clears a stale key whose object never landed in storage", async () => {
        mocks.queries.selectStaleStorageKeys.mockResolvedValue([
            { jobId: "job-x", key: "exports/u/job-x-crashed.zip" },
        ]);
        mocks.storage.deleteFile.mockRejectedValue(enoent());

        await tick();

        expect(mocks.queries.clearStaleStorageKey).toHaveBeenCalledWith(
            "job-x",
            "exports/u/job-x-crashed.zip",
        );
    });

    it("retries queued storage deletes on every tick", async () => {
        await tick();

        expect(
            mocks.deletionQueue.sweepStorageDeletionQueue,
        ).toHaveBeenCalledWith(mocks.storage);
    });

    it("keeps the user's older archives when the new archive omitted audio", async () => {
        mocks.queries.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1", claimToken: "token-1" },
        ]);
        mocks.buildArchive.buildAndUploadExportArchive.mockResolvedValue({
            recordingCount: 3,
            fileSize: 10,
            audioOmittedCount: 2,
        });
        mocks.queries.completeExportJob.mockResolvedValue(true);
        mocks.db.select.mockReturnValue({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();
        warnSpy.mockRestore();

        expect(mocks.queries.completeExportJob).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId: "job-1",
                retireOlderArchives: false,
            }),
        );
    });

    it("keeps the archive when completion committed but the call still failed", async () => {
        mocks.queries.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1", claimToken: "token-1" },
        ]);
        mocks.buildArchive.buildAndUploadExportArchive.mockResolvedValue({
            recordingCount: 1,
            fileSize: 10,
            audioOmittedCount: 0,
        });
        mocks.queries.completeExportJob.mockRejectedValue(
            new Error("Connection terminated unexpectedly"),
        );
        mocks.queries.recordExportJobFailure.mockResolvedValue(null);
        mocks.queries.isExportArchiveReferenced.mockResolvedValue(true);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();
        warnSpy.mockRestore();

        expect(mocks.queries.isExportArchiveReferenced).toHaveBeenCalledWith({
            jobId: "job-1",
            userId: "user-1",
            storageKey: "exports/user-1/job-1-token-1.zip",
        });
        expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
        expect(
            mocks.storageDeletions.enqueueStorageDeletions,
        ).not.toHaveBeenCalled();
    });

    it("still discards a superseded attempt's object when the failure could not be recorded", async () => {
        mocks.queries.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1", claimToken: "old" },
        ]);
        mocks.buildArchive.buildAndUploadExportArchive.mockRejectedValue(
            new Error("boom"),
        );
        mocks.queries.recordExportJobFailure.mockResolvedValue(null);
        mocks.queries.isExportArchiveReferenced.mockResolvedValue(false);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();
        warnSpy.mockRestore();

        expect(mocks.storage.deleteFile).toHaveBeenCalledWith(
            "exports/user-1/job-1-old.zip",
        );
    });
});
