/**
 * Regression test for issue #56:
 *   "Request for a delete recording option in the UI"
 *
 * Sync is keyed on `recordings.plaudFileId` (Plaud's file id). Hard-deleting
 * a row would cause the next sync to treat the recording as new and
 * re-download it. To make UI delete persistent across syncs, the row is
 * retained as a tombstone via `recordings.deletedAt`, the audio file is
 * removed from storage, and the transcription / AI rows are deleted.
 *
 * These tests cover:
 *   1. The sync worker skips tombstoned rows (no download, no DB write).
 *   2. The sync worker still updates a non-tombstoned row when versions differ.
 *   3. DELETE /api/recordings/[id] enforces userId scope (404 for other users).
 *   4. DELETE deletes the storage object, child rows, and tombstones the
 *      recording row — in that order — inside a single DB transaction.
 *   5. DELETE refuses to tombstone when the storage provider fails for any
 *      reason other than "already gone", so retries don't leak orphan blobs.
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
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

// Routes go through requireApiSession (auth + suspension check) which
// throws AppError on failure. The tests reuse the same
// `auth.api.getSession` mock and forward through here. Suspension is
// treated as never-set in these regression tests; admin-side behavior
// is covered by src/tests/admin/*.
vi.mock("@/lib/auth-server", async () => {
    const { auth } = await import("@/lib/auth");
    const { AppError, ErrorCode } = await import("@/lib/errors");
    return {
        requireApiSession: async (request: Request) => {
            const session = await auth.api.getSession({
                headers: request.headers,
            });
            if (!session?.user) {
                throw new AppError(
                    ErrorCode.AUTH_SESSION_MISSING,
                    "Unauthorized",
                    401,
                );
            }
            return session;
        },
    };
});

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
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

import { db } from "@/db";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

describe("Issue #56 — delete recording tombstone", () => {
    const mockUserId = "user-123";

    const mockPlaudRecording = {
        id: "plaud-1",
        filename: "Recording 1.mp3",
        duration: 60000,
        start_time: "2024-01-01T10:00:00Z",
        end_time: "2024-01-01T10:01:00Z",
        filesize: 1024000,
        file_md5: "abc123",
        serial_number: "SN123",
        // Bumped version forces sync to re-evaluate the existing row.
        version_ms: 9999,
        timezone: 0,
        zonemins: 0,
        scene: 0,
        is_trash: false,
    };

    const mockConnection = {
        id: "conn-1",
        userId: mockUserId,
        bearerToken: "encrypted-token",
    };

    const buildSelectChain = (results: unknown[][]) => {
        const chain = (db.select as Mock).mockReset();
        for (const result of results) {
            chain.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(result),
                    }),
                }),
            });
        }
    };

    let storageMock: {
        uploadFile: Mock;
        downloadFile: Mock;
        deleteFile: Mock;
    };
    let plaudClientMock: {
        getRecordings: Mock;
        downloadRecording: Mock;
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        storageMock = (await (createUserStorageProvider as Mock)(
            mockUserId,
        )) as typeof storageMock;
        storageMock.uploadFile.mockClear();
        storageMock.downloadFile.mockClear();
        storageMock.deleteFile.mockClear();

        plaudClientMock = {
            getRecordings: vi.fn().mockResolvedValue({
                data_file_list: [mockPlaudRecording],
            }),
            downloadRecording: vi.fn().mockResolvedValue(Buffer.from("audio")),
        };
        (createPlaudClient as Mock).mockResolvedValue(plaudClientMock);

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        (db.insert as Mock).mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: "new-rec" }]),
            }),
        });
    });

    it("skips tombstoned recordings without re-downloading", async () => {
        const tombstoned = {
            id: "local-rec-1",
            plaudFileId: "plaud-1",
            // Older version than the incoming Plaud record — without the
            // tombstone check, sync would treat this as an update.
            plaudVersion: "1000",
            deletedAt: new Date("2024-02-01T00:00:00Z"),
        };

        buildSelectChain([
            [mockConnection], // load Plaud connection
            [{ id: "settings-1" }], // user settings
            [{ email: "test@example.com" }], // user email lookup
            [tombstoned], // existingRecording lookup in processRecording
        ]);

        const result = await syncRecordingsForUser(mockUserId);

        expect(result.newRecordings).toBe(0);
        expect(result.updatedRecordings).toBe(0);
        expect(result.errors).toEqual([]);
        // No audio download, no upload, no recording row insert for the
        // tombstoned row. (db.update is still invoked once at the end of
        // sync to bump plaudConnections.lastSync — we only care that the
        // recordings table is untouched, which is reflected by the
        // updatedRecordings counter staying at 0.)
        expect(storageMock.uploadFile).not.toHaveBeenCalled();
        expect(plaudClientMock.downloadRecording).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("still updates a non-tombstoned recording when versions differ", async () => {
        const existing = {
            id: "local-rec-1",
            plaudFileId: "plaud-1",
            plaudVersion: "1000",
            deletedAt: null,
        };

        buildSelectChain([
            [mockConnection],
            [{ id: "settings-1" }],
            [{ email: "test@example.com" }],
            [existing],
            // uniqueStorageKey lookup — empty so the candidate name is unique.
            [],
        ]);

        const result = await syncRecordingsForUser(mockUserId);

        expect(result.updatedRecordings).toBe(1);
        expect(result.newRecordings).toBe(0);
        expect(storageMock.uploadFile).toHaveBeenCalledTimes(1);
        expect(db.update).toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// DELETE /api/recordings/[id]
// -----------------------------------------------------------------------

import { DELETE as deleteRecording } from "@/app/api/recordings/[id]/route";
import {
    aiEnhancements,
    recordings as recordingsTable,
    transcriptions as transcriptionsTable,
    webhookDeliveries,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider as createStorage } from "@/lib/storage/factory";
import { emitEvent } from "@/lib/webhooks/emit";

describe("DELETE /api/recordings/[id]", () => {
    const userId = "user-123";
    const recordingId = "rec-1";
    const storagePath = "user-123/Recording-1.mp3";

    const params = Promise.resolve({ id: recordingId });
    const makeRequest = () =>
        new Request(`http://localhost/api/recordings/${recordingId}`, {
            method: "DELETE",
        });

    let txCalls: Array<{ table: string; op: "delete" | "update" }>;
    let txSets: Array<{ table: string; values: Record<string, unknown> }>;

    beforeEach(() => {
        vi.clearAllMocks();
        txCalls = [];
        txSets = [];

        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: userId },
        });

        // db.transaction: invoke callback with a tx object whose .delete /
        // .update calls are recorded by table-reference identity so we can
        // assert both the operation order and the target table.
        const tableName = (t: unknown): string =>
            t === transcriptionsTable
                ? "transcriptions"
                : t === aiEnhancements
                  ? "ai_enhancements"
                  : t === recordingsTable
                    ? "recordings"
                    : t === webhookDeliveries
                      ? "webhook_deliveries"
                      : "unknown";

        (db.transaction as Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<void>) => {
                const tx = {
                    delete: vi.fn((table: unknown) => ({
                        where: vi.fn().mockImplementation(() => {
                            txCalls.push({
                                table: tableName(table),
                                op: "delete",
                            });
                            return Promise.resolve(undefined);
                        }),
                    })),
                    update: vi.fn((table: unknown) => ({
                        set: vi.fn((values: Record<string, unknown>) => ({
                            where: vi.fn().mockImplementation(() => {
                                txCalls.push({
                                    table: tableName(table),
                                    op: "update",
                                });
                                txSets.push({
                                    table: tableName(table),
                                    values,
                                });
                                return Promise.resolve(undefined);
                            }),
                        })),
                    })),
                };
                await cb(tx);
            },
        );
    });

    /**
     * Capture the expression handed to `.where(...)` so individual tests
     * can assert that the userId scope filter is actually present. Returns
     * a `getWhereExpr()` accessor that reads the most-recent call argument.
     */
    const stubRecordingLookup = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
        });
        (db.select as Mock).mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: whereSpy,
            }),
        });
        return {
            getWhereExpr: () => whereSpy.mock.calls.at(-1)?.[0],
        };
    };

    /**
     * Walk a Drizzle SQL/expression tree looking for a reference to the
     * given column object. Drizzle composes `and(eq(a, b), ...)` into
     * nested objects holding `queryChunks`, `left`, `right`, etc.; we
     * recurse over the common shapes. Returns true iff `col` appears
     * anywhere in the tree.
     */
    const exprReferencesColumn = (
        expr: unknown,
        col: unknown,
        seen = new Set<unknown>(),
    ): boolean => {
        if (expr == null || typeof expr !== "object") return false;
        if (expr === col) return true;
        if (seen.has(expr)) return false;
        seen.add(expr);
        for (const key of [
            "queryChunks",
            "sql",
            "left",
            "right",
            "value",
            "args",
            "chunks",
            "expr",
        ]) {
            const v = (expr as Record<string, unknown>)[key];
            if (Array.isArray(v)) {
                if (v.some((x) => exprReferencesColumn(x, col, seen)))
                    return true;
            } else if (exprReferencesColumn(v, col, seen)) {
                return true;
            }
        }
        return false;
    };

    it("scopes the recording lookup by userId (and returns 404 when no row matches)", async () => {
        const lookup = stubRecordingLookup([]);

        const res = await deleteRecording(makeRequest(), { params });
        expect(res.status).toBe(404);
        expect(createStorage).not.toHaveBeenCalled();
        expect(db.transaction).not.toHaveBeenCalled();

        // Critical: confirm the WHERE clause references `recordings.userId`.
        // Without this assertion the test would still pass if the handler
        // dropped the userId scope filter, since the mock returns [] for
        // any query.
        const whereExpr = lookup.getWhereExpr();
        expect(whereExpr).toBeDefined();
        expect(exprReferencesColumn(whereExpr, recordingsTable.userId)).toBe(
            true,
        );
        expect(exprReferencesColumn(whereExpr, recordingsTable.id)).toBe(true);
        expect(exprReferencesColumn(whereExpr, recordingsTable.deletedAt)).toBe(
            true,
        );
    });

    it("deletes storage, then child rows + webhook payloads + tombstone in one tx", async () => {
        const deleteFile = vi.fn().mockResolvedValue(undefined);
        (createStorage as Mock).mockResolvedValue({
            uploadFile: vi.fn(),
            downloadFile: vi.fn(),
            deleteFile,
        });
        stubRecordingLookup([
            { id: recordingId, userId, storagePath, deletedAt: null },
        ]);

        const res = await deleteRecording(makeRequest(), { params });
        expect(res.status).toBe(200);
        expect(deleteFile).toHaveBeenCalledWith(storagePath);
        // Storage delete must happen before the DB transaction opens.
        expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(
            (db.transaction as Mock).mock.invocationCallOrder[0],
        );
        // All writes ran in the same transaction…
        expect(txCalls).toHaveLength(4);
        // …in this order: transcriptions → ai_enhancements → webhook redaction → recordings.
        expect(txCalls.map((c) => `${c.op}:${c.table}`)).toEqual([
            "delete:transcriptions",
            "delete:ai_enhancements",
            "update:webhook_deliveries",
            "update:recordings",
        ]);
        const webhookUpdate = txSets.find(
            (entry) => entry.table === "webhook_deliveries",
        );
        expect(webhookUpdate?.values.payload).toMatchObject({
            recording_id: recordingId,
            redacted: true,
        });
        expect(emitEvent).toHaveBeenCalledWith(
            "recording.deleted",
            userId,
            recordingId,
        );
        expect(
            (db.transaction as Mock).mock.invocationCallOrder[0],
        ).toBeLessThan((emitEvent as Mock).mock.invocationCallOrder[0]);
    });

    it("refuses to tombstone when storage delete fails for a non-not-found reason", async () => {
        const deleteFile = vi
            .fn()
            .mockRejectedValue(new Error("S3 internal error 503"));
        (createStorage as Mock).mockResolvedValue({
            uploadFile: vi.fn(),
            downloadFile: vi.fn(),
            deleteFile,
        });
        stubRecordingLookup([
            { id: recordingId, userId, storagePath, deletedAt: null },
        ]);

        const res = await deleteRecording(makeRequest(), { params });
        expect(res.status).toBe(500);
        // No tombstone, no orphan: retry is safe.
        expect(db.transaction).not.toHaveBeenCalled();
        expect(emitEvent).not.toHaveBeenCalled();
    });

    it("still tombstones when storage reports the object is already gone", async () => {
        const deleteFile = vi
            .fn()
            .mockRejectedValue(
                new Error("Failed to delete file from local storage: ENOENT"),
            );
        (createStorage as Mock).mockResolvedValue({
            uploadFile: vi.fn(),
            downloadFile: vi.fn(),
            deleteFile,
        });
        stubRecordingLookup([
            { id: recordingId, userId, storagePath, deletedAt: null },
        ]);

        const res = await deleteRecording(makeRequest(), { params });
        expect(res.status).toBe(200);
        expect(db.transaction).toHaveBeenCalledTimes(1);
        expect(txCalls.map((c) => `${c.op}:${c.table}`)).toEqual([
            "delete:transcriptions",
            "delete:ai_enhancements",
            "update:webhook_deliveries",
            "update:recordings",
        ]);
        expect(emitEvent).toHaveBeenCalledWith(
            "recording.deleted",
            userId,
            recordingId,
        );
    });
});
