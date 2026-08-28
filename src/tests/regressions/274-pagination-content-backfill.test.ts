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
import {
    aiEnhancements,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
    users,
} from "@/db/schema";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { resetAutoTranscribeStateForTests } from "@/lib/sync/auto-transcribe-state";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import { upsertTranscription } from "@/lib/transcription/persist";

const USER_ID = "user-274";
const PAGE_SIZE = 50;

type Fixture = {
    rec: ReturnType<typeof plaudRecording>;
    deletedAt?: Date | null;
    hasPlaudTranscript?: boolean;
};

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

function fixture(
    index: number,
    opts: { deletedAt?: Date | null; hasPlaudTranscript?: boolean } = {},
): Fixture {
    return {
        rec: plaudRecording(index),
        deletedAt: opts.deletedAt,
        hasPlaudTranscript: opts.hasPlaudTranscript,
    };
}

function findLocalId(clause: unknown): string | undefined {
    const seen = new Set<unknown>();
    const stack: unknown[] = [clause];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (cur == null || seen.has(cur)) continue;
        if (typeof cur === "string" && cur.startsWith("local-")) return cur;
        if (typeof cur !== "object") continue;
        seen.add(cur);
        if (Array.isArray(cur)) stack.push(...cur);
        else stack.push(...Object.values(cur as Record<string, unknown>));
    }
    return undefined;
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
    fixtures: Fixture[];
}) {
    const byLocalId = new Map(
        opts.fixtures.map((f) => [`local-${f.rec.id}`, f]),
    );
    let recordingLookup = 0;

    (db.select as Mock).mockImplementation(() => {
        let table: unknown;
        let joined = false;
        let whereClause: unknown;
        const chain = {
            from: (next: unknown) => {
                table = next;
                return chain;
            },
            leftJoin: () => {
                joined = true;
                return chain;
            },
            where: (clause?: unknown) => {
                whereClause = clause;
                return chain;
            },
            limit: () => {
                if (table === plaudConnections) {
                    return Promise.resolve([
                        {
                            id: "conn-1",
                            userId: USER_ID,
                            bearerToken: "encrypted-token",
                        },
                    ]);
                }
                if (table === userSettings) {
                    return Promise.resolve([
                        { importPlaudContent: opts.importPlaudContent },
                    ]);
                }
                if (table === users) {
                    return Promise.resolve([{ email: "test@example.com" }]);
                }
                if (table === recordings) {
                    if (joined) {
                        const unseen = opts.fixtures
                            .slice(recordingLookup)
                            .find((f) => !f.deletedAt && !f.hasPlaudTranscript);
                        return Promise.resolve(
                            unseen ? [{ id: `local-${unseen.rec.id}` }] : [],
                        );
                    }
                    const f = opts.fixtures[recordingLookup++];
                    if (!f) return Promise.resolve([]);
                    return Promise.resolve([
                        {
                            id: `local-${f.rec.id}`,
                            plaudFileId: f.rec.id,
                            plaudVersion: "1000",
                            deletedAt: f.deletedAt ?? null,
                        },
                    ]);
                }
                if (table === transcriptions) {
                    const localId = findLocalId(whereClause);
                    const f = localId ? byLocalId.get(localId) : undefined;
                    if (f?.hasPlaudTranscript) {
                        return Promise.resolve([{ id: `tr-${f.rec.id}` }]);
                    }
                    return Promise.resolve([]);
                }
                if (table === aiEnhancements) {
                    return Promise.resolve([]);
                }
                return Promise.resolve([]);
            },
        };
        return chain;
    });
}

function mockPlaudPages(
    pages: ReturnType<typeof plaudRecording>[][],
    extras: {
        getFileDetail?: Mock;
        fetchContentLink?: Mock;
    } = {},
) {
    const getRecordings = vi.fn(async (skip: number) => {
        const pageIndex = skip / PAGE_SIZE;
        return { data_file_list: pages[pageIndex] ?? [] };
    });
    const getFileDetail =
        extras.getFileDetail ??
        vi.fn(async (fileId: string) => readyDetail(fileId));
    const fetchContentLink =
        extras.fetchContentLink ??
        vi.fn(async () => [{ speaker: 1, content: "hello from plaud" }]);
    (createPlaudClient as Mock).mockResolvedValue({
        getRecordings,
        getFileDetail,
        fetchContentLink,
        downloadRecording: vi.fn(),
    });
    return { getRecordings, getFileDetail };
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
        const tombstone = fixture(0, { deletedAt: new Date("2024-02-01") });
        const alreadyImported = fixture(1, { hasPlaudTranscript: true });
        const page1Rest = Array.from({ length: PAGE_SIZE - 2 }, (_, i) =>
            fixture(i + 2),
        );
        const page1 = [tombstone, alreadyImported, ...page1Rest];
        const page2 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(PAGE_SIZE + i),
        );
        const older = fixture(PAGE_SIZE * 2);
        const fixtures = [...page1, ...page2, older];

        const { getRecordings, getFileDetail } = mockPlaudPages([
            page1.map((f) => f.rec),
            page2.map((f) => f.rec),
            [older.rec],
        ]);
        mockSelects({ importPlaudContent: true, fixtures });

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

        const fetched = getFileDetail.mock.calls.map((c) => c[0] as string);
        expect(fetched).not.toContain(tombstone.rec.id);
        expect(fetched).not.toContain(alreadyImported.rec.id);
        expect(fetched).toContain(older.rec.id);
        expect(upsertTranscription).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: USER_ID,
                recordingId: `local-${older.rec.id}`,
                source: "plaud",
                text: "Speaker 1: hello from plaud",
            }),
        );
        expect(upsertTranscription).not.toHaveBeenCalledWith(
            expect.objectContaining({
                recordingId: `local-${tombstone.rec.id}`,
            }),
        );
        expect(upsertTranscription).not.toHaveBeenCalledWith(
            expect.objectContaining({
                recordingId: `local-${alreadyImported.rec.id}`,
            }),
        );
    });

    it("still stops after two no-change pages when Plaud import is off", async () => {
        const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => fixture(i));
        const page2 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(PAGE_SIZE + i),
        );
        const older = fixture(PAGE_SIZE * 2);
        const { getRecordings, getFileDetail } = mockPlaudPages([
            page1.map((f) => f.rec),
            page2.map((f) => f.rec),
            [older.rec],
        ]);
        mockSelects({
            importPlaudContent: false,
            fixtures: [...page1, ...page2, older],
        });

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

    it("stops after two empty pages when every seen row is already imported", async () => {
        const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(i, { hasPlaudTranscript: true }),
        );
        const page2 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(PAGE_SIZE + i, { hasPlaudTranscript: true }),
        );
        const older = fixture(PAGE_SIZE * 2, { hasPlaudTranscript: true });
        const { getRecordings, getFileDetail } = mockPlaudPages([
            page1.map((f) => f.rec),
            page2.map((f) => f.rec),
            [older.rec],
        ]);
        mockSelects({
            importPlaudContent: true,
            fixtures: [...page1, ...page2, older],
        });

        await syncRecordingsForUser(USER_ID);

        expect(getRecordings.mock.calls.map((c) => c[0])).toEqual([
            0,
            PAGE_SIZE,
        ]);
        expect(getFileDetail).not.toHaveBeenCalled();
        expect(upsertTranscription).not.toHaveBeenCalled();
    });

    it("keeps paging when recent pages are imported and an older row still needs content", async () => {
        const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(i, { hasPlaudTranscript: true }),
        );
        const page2 = Array.from({ length: PAGE_SIZE }, (_, i) =>
            fixture(PAGE_SIZE + i, { hasPlaudTranscript: true }),
        );
        const older = fixture(PAGE_SIZE * 2);
        const { getRecordings, getFileDetail } = mockPlaudPages([
            page1.map((f) => f.rec),
            page2.map((f) => f.rec),
            [older.rec],
        ]);
        mockSelects({
            importPlaudContent: true,
            fixtures: [...page1, ...page2, older],
        });

        await syncRecordingsForUser(USER_ID);

        expect(getRecordings).toHaveBeenCalledWith(
            PAGE_SIZE * 2,
            PAGE_SIZE,
            0,
            "edit_time",
            true,
        );
        expect(getFileDetail.mock.calls.map((c) => c[0])).toEqual([
            older.rec.id,
        ]);
        expect(upsertTranscription).toHaveBeenCalledTimes(1);
        expect(upsertTranscription).toHaveBeenCalledWith(
            expect.objectContaining({
                recordingId: `local-${older.rec.id}`,
            }),
        );
    });
});
