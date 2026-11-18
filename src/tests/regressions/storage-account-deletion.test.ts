/**
 * Regression: account deletion orphaned export archives and dropped
 * failed audio deletes.
 *
 * `deleteUserAccount` only deleted recording audio (failures were only
 * logged) and never looked at export archives; their `export_jobs` rows
 * cascade with the user, so the zip objects were left with nothing
 * pointing at them.
 *
 * After the fix, every export key the user's jobs may have written is
 * deleted with the audio, objects that are already gone count as
 * deleted, and keys whose delete failed are handed to `deleteUser`,
 * which queues them for retry in the same transaction.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    db: { select: vi.fn() },
    billing: {
        claimUsersDueForDeletion: vi.fn(),
        listRecordingStoragePaths: vi.fn(),
        deleteUser: vi.fn(),
    },
    exportJobs: { listExportStorageKeysForUser: vi.fn() },
    email: { sendAccountDeletedEmail: vi.fn() },
    storage: { deleteFile: vi.fn() },
}));

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.example.com" } }));
vi.mock("@/db/queries/billing", () => mocks.billing);
vi.mock("@/db/queries/export-jobs", () => mocks.exportJobs);
vi.mock("@/lib/notifications/email", () => mocks.email);
vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => mocks.storage,
}));

import { deleteUserAccount } from "@/lib/hosted/billing/deletion";

function enoent(): Error {
    return new Error("Failed to delete file from local storage", {
        cause: Object.assign(new Error("ENOENT: no such file"), {
            code: "ENOENT",
        }),
    });
}

describe("deleteUserAccount storage cleanup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.db.select.mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: async () => [{ email: "u1@example.com" }],
                }),
            }),
        });
        mocks.email.sendAccountDeletedEmail.mockResolvedValue(true);
        mocks.billing.deleteUser.mockResolvedValue(undefined);
        mocks.storage.deleteFile.mockResolvedValue(undefined);
    });

    it("deletes the user's export archives as well as recording audio", async () => {
        mocks.billing.listRecordingStoragePaths.mockResolvedValue(["u1/a.ogg"]);
        mocks.exportJobs.listExportStorageKeysForUser.mockResolvedValue([
            "exports/u1/job-1-t1.zip",
            "exports/u1/job-2-t2.zip",
        ]);

        await deleteUserAccount("u1");

        expect(
            mocks.exportJobs.listExportStorageKeysForUser,
        ).toHaveBeenCalledWith("u1");
        expect(mocks.storage.deleteFile.mock.calls.map(([key]) => key)).toEqual(
            ["u1/a.ogg", "exports/u1/job-1-t1.zip", "exports/u1/job-2-t2.zip"],
        );
        expect(mocks.billing.deleteUser).toHaveBeenCalledWith("u1", {
            pendingStorageKeys: [],
        });
    });

    it("hands failed keys to deleteUser for durable retry, but not keys that are already gone", async () => {
        mocks.billing.listRecordingStoragePaths.mockResolvedValue([
            "u1/a.ogg",
            "u1/tombstoned.ogg",
        ]);
        mocks.exportJobs.listExportStorageKeysForUser.mockResolvedValue([
            "exports/u1/job-1-t1.zip",
        ]);
        mocks.storage.deleteFile.mockImplementation(async (key: string) => {
            if (key === "u1/tombstoned.ogg") throw enoent();
            if (key === "exports/u1/job-1-t1.zip") {
                throw new Error("S3 503");
            }
        });
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        const result = await deleteUserAccount("u1");
        errorSpy.mockRestore();

        expect(result.storageErrors).toBe(1);
        expect(mocks.billing.deleteUser).toHaveBeenCalledWith("u1", {
            pendingStorageKeys: ["exports/u1/job-1-t1.zip"],
        });
    });

    it("keeps the user row when storage deletes fail and queueing them fails too", async () => {
        mocks.billing.listRecordingStoragePaths.mockResolvedValue(["u1/a.ogg"]);
        mocks.exportJobs.listExportStorageKeysForUser.mockResolvedValue([]);
        mocks.storage.deleteFile.mockRejectedValue(new Error("S3 503"));
        mocks.billing.deleteUser.mockRejectedValue(new Error("db down"));
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await expect(deleteUserAccount("u1")).rejects.toThrow("db down");
        errorSpy.mockRestore();

        expect(mocks.email.sendAccountDeletedEmail).not.toHaveBeenCalled();
    });
});
