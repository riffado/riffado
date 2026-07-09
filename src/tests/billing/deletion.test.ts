import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emailMock, envMock, queriesMock, storageMock } = vi.hoisted(
    () => ({
        dbMock: { select: vi.fn() },
        emailMock: { sendAccountDeletedEmail: vi.fn() },
        envMock: { APP_URL: "https://app.example.com" },
        queriesMock: {
            claimUsersDueForDeletion: vi.fn(),
            listRecordingStoragePaths: vi.fn(),
            deleteUser: vi.fn(),
        },
        storageMock: {
            deleteFile: vi.fn(),
        },
    }),
);

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/notifications/email", () => emailMock);
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

import {
    deleteUserAccount,
    processDueAccountDeletions,
} from "@/lib/hosted/billing/deletion";

describe("deleteUserAccount", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        emailMock.sendAccountDeletedEmail.mockResolvedValue(true);
        stubEmailLookup("default@example.com");
    });

    it("deletes each storage object then the user row", async () => {
        stubEmailLookup("u1@example.com");
        queriesMock.listRecordingStoragePaths.mockResolvedValue([
            "users/u1/a.opus",
            "users/u1/b.opus",
        ]);
        storageMock.deleteFile.mockResolvedValue(undefined);
        queriesMock.deleteUser.mockResolvedValue(undefined);

        const result = await deleteUserAccount("u1");

        expect(result.storageErrors).toBe(0);
        expect(storageMock.deleteFile).toHaveBeenCalledTimes(2);
        expect(storageMock.deleteFile).toHaveBeenNthCalledWith(
            1,
            "users/u1/a.opus",
        );
        expect(queriesMock.deleteUser).toHaveBeenCalledWith("u1");
    });

    it("continues past per-object storage errors and still deletes the user row", async () => {
        stubEmailLookup("u1@example.com");
        queriesMock.listRecordingStoragePaths.mockResolvedValue([
            "a",
            "b",
            "c",
        ]);
        storageMock.deleteFile
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("S3 503"))
            .mockResolvedValueOnce(undefined);
        queriesMock.deleteUser.mockResolvedValue(undefined);

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await deleteUserAccount("u1");
        errorSpy.mockRestore();

        expect(result.storageErrors).toBe(1);
        expect(queriesMock.deleteUser).toHaveBeenCalledWith("u1");
    });

    it("deletes the user row even when there are zero stored objects", async () => {
        stubEmailLookup("u1@example.com");
        queriesMock.listRecordingStoragePaths.mockResolvedValue([]);
        queriesMock.deleteUser.mockResolvedValue(undefined);

        const result = await deleteUserAccount("u1");

        expect(result.storageErrors).toBe(0);
        expect(storageMock.deleteFile).not.toHaveBeenCalled();
        expect(queriesMock.deleteUser).toHaveBeenCalledWith("u1");
    });
});

describe("processDueAccountDeletions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        emailMock.sendAccountDeletedEmail.mockResolvedValue(true);
        stubEmailLookup("default@example.com");
    });

    it("returns zeros when no users are due", async () => {
        queriesMock.claimUsersDueForDeletion.mockResolvedValue([]);
        const result = await processDueAccountDeletions();
        expect(result).toEqual({
            deleted: 0,
            storagePartial: 0,
            errors: 0,
        });
    });

    it("counts deleted vs storage-partial vs errors across a batch", async () => {
        queriesMock.claimUsersDueForDeletion.mockResolvedValue([
            "ok",
            "partial",
            "throw",
        ]);
        stubEmailLookup("ok@example.com");
        stubEmailLookup("partial@example.com");
        stubEmailLookup("throw@example.com");
        queriesMock.listRecordingStoragePaths.mockImplementation(
            async (id: string) => (id === "throw" ? [] : ["x"]),
        );
        storageMock.deleteFile.mockImplementation(async () => {
            const callCount = storageMock.deleteFile.mock.calls.length;
            if (callCount === 2) throw new Error("S3 timeout");
        });
        queriesMock.deleteUser.mockImplementation(async (id: string) => {
            if (id === "throw") throw new Error("FK violation");
        });

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await processDueAccountDeletions();
        errorSpy.mockRestore();

        expect(result).toEqual({
            deleted: 2,
            storagePartial: 1,
            errors: 1,
        });
    });

    it("uses the configured limit", async () => {
        queriesMock.claimUsersDueForDeletion.mockResolvedValue([]);
        await processDueAccountDeletions({ limit: 5 });
        expect(queriesMock.claimUsersDueForDeletion).toHaveBeenCalledWith(5);
    });

    it("defaults the limit to 25 when omitted", async () => {
        queriesMock.claimUsersDueForDeletion.mockResolvedValue([]);
        await processDueAccountDeletions();
        expect(queriesMock.claimUsersDueForDeletion).toHaveBeenCalledWith(25);
    });
});
