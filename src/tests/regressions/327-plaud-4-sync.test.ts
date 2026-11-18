/**
 * Regression: #327 follow-up, sync of recordings already stored before or
 * after the Plaud 4.0 migration.
 *
 * - A recording first stored as Ogg and re-downloaded on 4.0 as MP3 must not
 *   keep its `.ogg` key (the audio route derives the MIME from it).
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/hosted/billing/storage-cap", () => ({
    enforceStorageCap: vi.fn().mockResolvedValue({
        allowed: true,
        currentBytes: 0,
        limitBytes: null,
    }),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn(),
        deleteFile: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));

import { db } from "@/db";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

const USER = "user-327";
const OLD_PATH = `${USER}/p327.ogg`;
const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(28)]);

interface StoredRow {
    id: string;
    plaudFileId: string;
    plaudVersion: string;
    storagePath: string;
    deletedAt: Date | null;
    deviceSn: string;
    timezone: number | null;
    zonemins: number | null;
    scene: number | null;
}

function storedRow(overrides: Partial<StoredRow> = {}): StoredRow {
    return {
        id: "rec-327",
        plaudFileId: "p327",
        plaudVersion: "1",
        storagePath: OLD_PATH,
        deletedAt: null,
        deviceSn: "SN-OLD",
        timezone: 2,
        zonemins: 30,
        scene: 7,
        ...overrides,
    };
}

function listedRecording(overrides: Record<string, unknown> = {}) {
    return {
        id: "p327",
        filename: "2026-10-28 11:43:10",
        duration: 1000,
        start_time: Date.UTC(2026, 9, 28, 10, 43, 10),
        end_time: Date.UTC(2026, 9, 28, 10, 43, 11),
        filesize: 8,
        file_md5: "",
        serial_number: "",
        version_ms: 2,
        edit_time: 2,
        timezone: 0,
        zonemins: 0,
        scene: 0,
        is_trash: false,
        is_trans: false,
        is_summary: false,
        source: "v4",
        ...overrides,
    };
}

function stubPlaud(recording: unknown, buffer: Buffer) {
    const client = {
        usingPlaudV4: true,
        getRecordings: vi.fn().mockResolvedValue({
            data_file_list: [recording],
        }),
        hydrateRecording: vi.fn(async (r: unknown) => r),
        downloadRecording: vi.fn().mockResolvedValue(buffer),
    };
    (createPlaudClient as Mock).mockResolvedValue(client);
    return client;
}

function stubSelects(connectionId: string, results: unknown[][]) {
    const select = (db.select as Mock).mockReset();
    for (const result of [
        [{ id: connectionId, userId: USER, bearerToken: "tok" }],
        [{ id: "settings-1" }],
        [{ email: "t@example.com" }],
        ...results,
    ]) {
        select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(result),
                }),
            }),
        });
    }
    select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
            }),
        }),
    });
}

function stubUpdateTransaction(
    locked: { deletedAt: Date | null } = {
        deletedAt: null,
    },
) {
    const setPayloads: Record<string, unknown>[] = [];
    (db.transaction as Mock).mockImplementation(
        async (cb: (tx: unknown) => Promise<boolean>) =>
            cb({
                select: vi.fn().mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            for: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([locked]),
                            }),
                        }),
                    }),
                }),
                update: vi.fn().mockReturnValue({
                    set: vi.fn((payload: Record<string, unknown>) => {
                        setPayloads.push(payload);
                        return {
                            where: vi.fn().mockResolvedValue(undefined),
                        };
                    }),
                }),
            }),
    );
    (db.update as Mock).mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    });
    return setPayloads;
}

async function storageMock() {
    const storage = (await createUserStorageProvider(USER)) as unknown as {
        uploadFile: Mock;
        deleteFile: Mock;
    };
    storage.uploadFile.mockClear();
    storage.deleteFile.mockReset().mockResolvedValue(undefined);
    return storage;
}

describe("#327 re-download of a stored recording on Plaud 4.0", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("moves an Ogg-keyed recording to an .mp3 key and deletes the old object after the update", async () => {
        const storage = await storageMock();
        stubPlaud(listedRecording(), mp3);
        stubSelects("conn-ext-1", [[storedRow()], [], []]);
        const setPayloads = stubUpdateTransaction();

        const result = await syncRecordingsForUser(USER);

        expect(result.errors).toEqual([]);
        expect(result.updatedRecordings).toBe(1);
        const newKey = `${USER}/p327.mp3`;
        expect(storage.uploadFile).toHaveBeenCalledWith(
            newKey,
            mp3,
            "audio/mpeg",
        );
        expect(setPayloads[0]?.storagePath).toBe(newKey);
        expect(storage.deleteFile).toHaveBeenCalledTimes(1);
        expect(storage.deleteFile).toHaveBeenCalledWith(OLD_PATH);
        expect(
            (db.transaction as Mock).mock.invocationCallOrder[0],
        ).toBeLessThan(storage.deleteFile.mock.invocationCallOrder[0]);
    });

    it("keeps the old object while another recording still references it", async () => {
        const storage = await storageMock();
        stubPlaud(listedRecording(), mp3);
        stubSelects("conn-ext-2", [[storedRow()], [], [{ id: "other-rec" }]]);
        const setPayloads = stubUpdateTransaction();

        const result = await syncRecordingsForUser(USER);

        expect(result.updatedRecordings).toBe(1);
        expect(setPayloads[0]?.storagePath).toBe(`${USER}/p327.mp3`);
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it("keeps the old object when the recording was deleted during the download", async () => {
        const storage = await storageMock();
        stubPlaud(listedRecording(), mp3);
        stubSelects("conn-ext-3", [[storedRow()], []]);
        stubUpdateTransaction({ deletedAt: new Date() });

        const result = await syncRecordingsForUser(USER);

        expect(result.updatedRecordings).toBe(0);
        expect(storage.deleteFile).toHaveBeenCalledTimes(1);
        expect(storage.deleteFile).toHaveBeenCalledWith(`${USER}/p327.mp3`);
    });

    it("logs and keeps the update when deleting the old object fails", async () => {
        const storage = await storageMock();
        storage.deleteFile.mockRejectedValue(new Error("s3 down"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            stubPlaud(listedRecording(), mp3);
            stubSelects("conn-ext-4", [[storedRow()], [], []]);
            const setPayloads = stubUpdateTransaction();

            const result = await syncRecordingsForUser(USER);

            expect(result.errors).toEqual([]);
            expect(result.updatedRecordings).toBe(1);
            expect(setPayloads[0]?.storagePath).toBe(`${USER}/p327.mp3`);
            expect(error).toHaveBeenCalledWith(
                `Failed to delete replaced storage object ${OLD_PATH}:`,
                expect.any(Error),
            );
        } finally {
            error.mockRestore();
        }
    });

    it("reuses the stored key when the extension matches", async () => {
        const storage = await storageMock();
        stubPlaud(listedRecording(), ogg);
        stubSelects("conn-ext-5", [[storedRow()], []]);
        const setPayloads = stubUpdateTransaction();

        const result = await syncRecordingsForUser(USER);

        expect(result.updatedRecordings).toBe(1);
        expect(storage.uploadFile).toHaveBeenCalledWith(
            OLD_PATH,
            ogg,
            "audio/ogg",
        );
        expect(setPayloads[0]?.storagePath).toBe(OLD_PATH);
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it("keeps the stored key for legacy recordings, as before", async () => {
        const storage = await storageMock();
        stubPlaud(listedRecording({ source: undefined }), mp3);
        stubSelects("conn-ext-6", [[storedRow()], []]);
        const setPayloads = stubUpdateTransaction();

        await syncRecordingsForUser(USER);

        expect(setPayloads[0]?.storagePath).toBe(OLD_PATH);
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });
});
