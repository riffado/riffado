/**
 * Regression for #274: two no-change pages stopped Plaud list pagination,
 * so older recordings never became content-import candidates.
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

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
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

vi.mock("@/lib/transcription/persist", () => ({
    upsertTranscription: vi.fn().mockResolvedValue({ committed: true }),
    upsertEnhancement: vi.fn().mockResolvedValue({ committed: true }),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/db";
import { plaudConnections, recordings, userSettings, users } from "@/db/schema";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { resetAutoTranscribeStateForTests } from "@/lib/sync/auto-transcribe-state";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import { upsertTranscription } from "@/lib/transcription/persist";

const USER_ID = "user-274";
const PAGE_SIZE = 50;

function plaudRecording(
    index: number,
    overrides: { is_trans?: boolean; is_summary?: boolean } = {},
) {
    return {
        id: `plaud-${index}`,
        filename: `Recording ${index}.mp3`,
        duration: 60000,
        start_time: "2024-01-01T10:00:00Z",
        end_time: "2024-01-01T10:01:00Z",
        filesize: 1024000,
        file_md5: `md5-${index}`,
        serial_number: "SN123",
        version_ms: 1000,
        timezone: 0,
        zonemins: 0,
        scene: 0,
        is_trash: false,
        is_trans: overrides.is_trans ?? true,
        is_summary: overrides.is_summary ?? false,
    };
}

function pageOf(startIndex: number, count: number) {
    return Array.from({ length: count }, (_, i) =>
        plaudRecording(startIndex + i),
    );
}

function readyDetail(fileId: string) {
    return {
        status: 0,
        data: {
            file_id: fileId,
            content_list: [
                {
                    data_id: `source_transaction:${fileId}`,
                    data_type: "transaction",
                    task_status: 1,
                    data_link: `https://s3.example/${fileId}.json`,
                },
            ],
        },
    };
}

function mockSelects(opts: {
    importPlaudContent: boolean;
    recordingsInOrder: ReturnType<typeof plaudRecording>[];
}) {
    let recordingLookup = 0;

    (db.select as Mock).mockImplementation(() => ({
        from: (table: unknown) => {
            const resolve = (rows: unknown[]) => ({
                where: () => ({
                    limit: () => Promise.resolve(rows),
                }),
            });

            if (table === plaudConnections) {
                return resolve([
                    {
                        id: "conn-1",
                        userId: USER_ID,
                        bearerToken: "encrypted-token",
                    },
                ]);
            }
            if (table === userSettings) {
                return resolve([
                    { importPlaudContent: opts.importPlaudContent },
                ]);
            }
            if (table === users) {
                return resolve([{ email: "test@example.com" }]);
            }
            if (table === recordings) {
                const rec = opts.recordingsInOrder[recordingLookup++];
                if (!rec) return resolve([]);
                return resolve([
                    {
                        id: `local-${rec.id}`,
                        plaudFileId: rec.id,
                        plaudVersion: "1000",
                        deletedAt: null,
                    },
                ]);
            }
            return resolve([]);
        },
    }));
}

describe("Issue #274 — pagination content backfill", () => {
    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
    });

    it("pages past two unchanged versions and imports a distinct older recording", async () => {
        const page1 = pageOf(0, PAGE_SIZE);
        const page2 = pageOf(PAGE_SIZE, PAGE_SIZE);
        const older = plaudRecording(PAGE_SIZE * 2);
        const page3 = [older];
        const all = [...page1, ...page2, ...page3];

        const getRecordings = vi.fn(async (skip: number) => {
            if (skip === 0) return { data_file_list: page1 };
            if (skip === PAGE_SIZE) return { data_file_list: page2 };
            if (skip === PAGE_SIZE * 2) return { data_file_list: page3 };
            return { data_file_list: [] };
        });
        const getFileDetail = vi.fn(async (fileId: string) =>
            readyDetail(fileId),
        );
        const fetchContentLink = vi.fn(async () => [
            { speaker: 1, content: "hello from plaud" },
        ]);

        (createPlaudClient as Mock).mockResolvedValue({
            getRecordings,
            getFileDetail,
            fetchContentLink,
            downloadRecording: vi.fn(),
        });

        mockSelects({ importPlaudContent: true, recordingsInOrder: all });

        const result = await syncRecordingsForUser(USER_ID);

        expect(result.newRecordings).toBe(0);
        expect(result.updatedRecordings).toBe(0);
        expect(getRecordings).toHaveBeenCalledWith(
            PAGE_SIZE * 2,
            PAGE_SIZE,
            0,
            "edit_time",
            true,
        );
        expect(getFileDetail).toHaveBeenCalledWith(older.id);
        expect(getFileDetail.mock.calls.map((c) => c[0])).toEqual(
            all.map((r) => r.id),
        );
        expect(upsertTranscription).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: USER_ID,
                recordingId: `local-${older.id}`,
                source: "plaud",
                text: "Speaker 1: hello from plaud",
            }),
        );
        expect(upsertTranscription).toHaveBeenCalledTimes(all.length);
    });

    it("still stops after two no-change pages when Plaud import is off", async () => {
        const page1 = pageOf(0, PAGE_SIZE);
        const page2 = pageOf(PAGE_SIZE, PAGE_SIZE);
        const older = plaudRecording(PAGE_SIZE * 2);
        const all = [...page1, ...page2, older];

        const getRecordings = vi.fn(async (skip: number) => {
            if (skip === 0) return { data_file_list: page1 };
            if (skip === PAGE_SIZE) return { data_file_list: page2 };
            if (skip === PAGE_SIZE * 2) return { data_file_list: [older] };
            return { data_file_list: [] };
        });
        const getFileDetail = vi.fn();

        (createPlaudClient as Mock).mockResolvedValue({
            getRecordings,
            getFileDetail,
            downloadRecording: vi.fn(),
        });

        mockSelects({ importPlaudContent: false, recordingsInOrder: all });

        const result = await syncRecordingsForUser(USER_ID);

        expect(result.newRecordings).toBe(0);
        expect(result.updatedRecordings).toBe(0);
        expect(getRecordings.mock.calls.map((c) => c[0])).toEqual([
            0,
            PAGE_SIZE,
        ]);
        expect(getFileDetail).not.toHaveBeenCalled();
        expect(upsertTranscription).not.toHaveBeenCalled();
    });
});
