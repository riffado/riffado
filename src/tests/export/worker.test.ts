import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    dbMock,
    queriesMock,
    buildArchiveMock,
    emailMock,
    storageMock,
    envMock,
} = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    queriesMock: {
        claimPendingExportJobs: vi.fn(),
        claimExpiredExportJobs: vi.fn(),
        completeExportJob: vi.fn(),
        recordExportJobFailure: vi.fn(),
        reclaimStaleProcessingExportJobs: vi.fn(),
        EXPORT_MAX_ATTEMPTS: 3,
    },
    buildArchiveMock: { buildAndUploadExportArchive: vi.fn() },
    emailMock: { sendExportReadyEmail: vi.fn() },
    storageMock: {
        deleteFile: vi.fn(),
    },
    envMock: { APP_URL: "https://app.example.com" },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/db/queries/export-jobs", () => queriesMock);
vi.mock("@/lib/export/build-archive", () => buildArchiveMock);
vi.mock("@/lib/notifications/email", () => emailMock);
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => storageMock,
}));

function stubEmailLookup(email: string | null) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(email ? [{ email }] : []),
            }),
        }),
    });
}

import { tick } from "@/lib/export/worker";

describe("export worker tick", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queriesMock.reclaimStaleProcessingExportJobs.mockResolvedValue(0);
        queriesMock.claimPendingExportJobs.mockResolvedValue([]);
        queriesMock.claimExpiredExportJobs.mockResolvedValue([]);
        queriesMock.recordExportJobFailure.mockResolvedValue({
            status: "failed",
            attempts: 3,
        });
        emailMock.sendExportReadyEmail.mockResolvedValue(true);
        storageMock.deleteFile.mockResolvedValue(undefined);
        stubEmailLookup("user@example.com");
    });

    it("does nothing when there are no jobs to claim or clean up", async () => {
        await tick();
        expect(
            buildArchiveMock.buildAndUploadExportArchive,
        ).not.toHaveBeenCalled();
        expect(queriesMock.completeExportJob).not.toHaveBeenCalled();
    });

    it("builds the archive for each claimed job and marks it completed", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-1", userId: "user-1" },
        ]);
        buildArchiveMock.buildAndUploadExportArchive.mockResolvedValue({
            recordingCount: 3,
            fileSize: 12345,
        });

        await tick();

        expect(
            buildArchiveMock.buildAndUploadExportArchive,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "user-1",
                storageKey: "exports/user-1/job-1.zip",
            }),
        );
        expect(queriesMock.completeExportJob).toHaveBeenCalledWith({
            jobId: "job-1",
            storageKey: "exports/user-1/job-1.zip",
            fileSize: 12345,
            recordingCount: 3,
        });
        expect(emailMock.sendExportReadyEmail).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user-1", jobId: "job-1" }),
        );
    });

    it("records the failure (permanent) and cleans up the partial object when the build exhausts retries", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-2", userId: "user-2" },
        ]);
        buildArchiveMock.buildAndUploadExportArchive.mockRejectedValue(
            new Error("storage unreachable"),
        );
        queriesMock.recordExportJobFailure.mockResolvedValue({
            status: "failed",
            attempts: 3,
        });
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await tick();
        errorSpy.mockRestore();

        expect(queriesMock.recordExportJobFailure).toHaveBeenCalledWith(
            "job-2",
            "storage unreachable",
        );
        expect(queriesMock.completeExportJob).not.toHaveBeenCalled();
        expect(storageMock.deleteFile).toHaveBeenCalledWith(
            "exports/user-2/job-2.zip",
        );
        expect(emailMock.sendExportReadyEmail).not.toHaveBeenCalled();
    });

    it("requeues (doesn't log as an error) when the failure hasn't exhausted retries yet", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-retry", userId: "user-1" },
        ]);
        buildArchiveMock.buildAndUploadExportArchive.mockRejectedValue(
            new Error("transient blip"),
        );
        queriesMock.recordExportJobFailure.mockResolvedValue({
            status: "pending",
            attempts: 1,
        });
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await tick();

        expect(queriesMock.recordExportJobFailure).toHaveBeenCalledWith(
            "job-retry",
            "transient blip",
        );
        // Retries are expected, not exceptional -- warn, not error.
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it("processes multiple claimed jobs independently -- one failure doesn't block another's completion", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-a", userId: "user-a" },
            { id: "job-b", userId: "user-b" },
        ]);
        buildArchiveMock.buildAndUploadExportArchive
            .mockRejectedValueOnce(new Error("job-a exploded"))
            .mockResolvedValueOnce({ recordingCount: 1, fileSize: 999 });
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await tick();
        errorSpy.mockRestore();

        expect(queriesMock.recordExportJobFailure).toHaveBeenCalledWith(
            "job-a",
            "job-a exploded",
        );
        expect(queriesMock.completeExportJob).toHaveBeenCalledWith(
            expect.objectContaining({ jobId: "job-b" }),
        );
    });

    it("sweeps expired completed jobs by deleting the storage object", async () => {
        queriesMock.claimExpiredExportJobs.mockResolvedValue([
            { id: "job-old", storageKey: "exports/user-x/job-old.zip" },
        ]);

        await tick();

        expect(storageMock.deleteFile).toHaveBeenCalledWith(
            "exports/user-x/job-old.zip",
        );
    });

    it("does not let a stuck cleanup deleteFile call abort the tick", async () => {
        queriesMock.claimExpiredExportJobs.mockResolvedValue([
            { id: "job-old", storageKey: "exports/user-x/job-old.zip" },
        ]);
        storageMock.deleteFile.mockRejectedValue(new Error("network error"));
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await expect(tick()).resolves.toBeUndefined();
        errorSpy.mockRestore();
    });

    it("reclaims stale processing jobs before claiming new pending ones", async () => {
        queriesMock.reclaimStaleProcessingExportJobs.mockResolvedValue(2);

        await tick();

        expect(queriesMock.reclaimStaleProcessingExportJobs).toHaveBeenCalled();
    });
});

describe("export worker stall guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        queriesMock.reclaimStaleProcessingExportJobs.mockResolvedValue(0);
        queriesMock.claimExpiredExportJobs.mockResolvedValue([]);
        storageMock.deleteFile.mockResolvedValue(undefined);
        stubEmailLookup("user@example.com");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("aborts a build that makes no progress for the stall window, and requeues it", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-stuck", userId: "user-1" },
        ]);
        queriesMock.recordExportJobFailure.mockResolvedValue({
            status: "pending",
            attempts: 1,
        });
        // A build that never resolves and never calls onProgress --
        // simulates a hung network read.
        buildArchiveMock.buildAndUploadExportArchive.mockImplementation(
            () => new Promise(() => {}),
        );
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const tickPromise = tick();
        await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
        await tickPromise;
        warnSpy.mockRestore();

        expect(queriesMock.recordExportJobFailure).toHaveBeenCalledWith(
            "job-stuck",
            expect.stringContaining("stalled"),
        );
    });

    it("does not abort a build that keeps reporting progress, even past the stall window", async () => {
        queriesMock.claimPendingExportJobs.mockResolvedValue([
            { id: "job-healthy", userId: "user-1" },
        ]);
        buildArchiveMock.buildAndUploadExportArchive.mockImplementation(
            ({ onProgress }: { onProgress: () => void }) =>
                new Promise((resolve) => {
                    // Report progress every 2 minutes -- well inside the
                    // 5-minute stall window -- for 8 minutes total (past
                    // where a fixed-duration timeout would have killed it).
                    let ticks = 0;
                    const interval = setInterval(
                        () => {
                            ticks += 1;
                            onProgress();
                            if (ticks >= 4) {
                                clearInterval(interval);
                                resolve({ recordingCount: 1, fileSize: 1 });
                            }
                        },
                        2 * 60 * 1000,
                    );
                }),
        );

        const tickPromise = tick();
        await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1000);
        await tickPromise;

        expect(queriesMock.completeExportJob).toHaveBeenCalledWith(
            expect.objectContaining({ jobId: "job-healthy" }),
        );
        expect(queriesMock.recordExportJobFailure).not.toHaveBeenCalled();
    });
});
