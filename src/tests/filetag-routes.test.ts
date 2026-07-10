import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, ""),
    ),
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// Keep validation/serialization real; stub only the Plaud client handle.
vi.mock("@/lib/filetags/service", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/lib/filetags/service")>();
    return {
        ...actual,
        getPlaudClientForUser: vi.fn(),
    };
});

import {
    DELETE as deleteFiletagRoute,
    PATCH as patchFiletagRoute,
} from "@/app/api/filetags/[id]/route";
import {
    POST as createFiletagRoute,
    GET as listFiletagsRoute,
} from "@/app/api/filetags/route";
import { POST as moveRecordingsRoute } from "@/app/api/recordings/filetag/route";
import { db } from "@/db";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, ErrorCode } from "@/lib/errors";
import { getPlaudClientForUser } from "@/lib/filetags/service";
import { emitEvent } from "@/lib/webhooks/emit";

const USER_ID = "user-1";

function request(path: string, body?: unknown, method = "POST") {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function idContext(id: string) {
    return { params: Promise.resolve({ id }) };
}

function queueSelects(results: unknown[][]) {
    let call = 0;
    (db.select as Mock).mockImplementation(() => {
        const result = call < results.length ? results[call] : [];
        call += 1;
        const chain: Record<string, unknown> = {};
        for (const method of ["from", "where", "orderBy", "groupBy", "limit"]) {
            chain[method] = () => chain;
        }
        // biome-ignore lint/suspicious/noThenProperty: drizzle fluent chains are thenables; the mock must be awaitable at any depth
        chain.then = (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
        return chain;
    });
}

function captureInserts() {
    const inserted: Record<string, unknown>[] = [];
    (db.insert as Mock).mockImplementation(() => ({
        values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return {
                returning: () =>
                    Promise.resolve([
                        {
                            id: "local-new",
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            ...values,
                        },
                    ]),
            };
        },
    }));
    return inserted;
}

function captureUpdates() {
    const updates: Record<string, unknown>[] = [];
    (db.update as Mock).mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
            updates.push(values);
            const chain = {
                where: () => chain,
                returning: () =>
                    Promise.resolve([
                        {
                            id: "tag-1",
                            userId: USER_ID,
                            plaudTagId: "9",
                            name: "Renamed",
                            icon: "iconfont_folder_meeting",
                            color: "#4c8eff",
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    ]),
                // biome-ignore lint/suspicious/noThenProperty: drizzle fluent chains are thenables; the mock must be awaitable at any depth
                then: (
                    resolve: (v: unknown) => unknown,
                    reject: (e: unknown) => unknown,
                ) => Promise.resolve(undefined).then(resolve, reject),
            };
            return chain;
        },
    }));
    return updates;
}

function captureDeletes() {
    const deletes: number[] = [];
    (db.delete as Mock).mockImplementation(() => {
        deletes.push(deletes.length);
        const chain = {
            where: () => chain,
            // biome-ignore lint/suspicious/noThenProperty: drizzle fluent chains are thenables; the mock must be awaitable at any depth
            then: (
                resolve: (v: unknown) => unknown,
                reject: (e: unknown) => unknown,
            ) => Promise.resolve(undefined).then(resolve, reject),
        };
        return chain;
    });
    return deletes;
}

function tagRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "tag-1",
        userId: USER_ID,
        plaudTagId: "9",
        name: "Meetings",
        icon: "iconfont_folder_meeting",
        color: "#4c8eff",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function plaudHandle(clientOverrides: Record<string, unknown> = {}) {
    return {
        client: {
            createFiletag: vi.fn().mockResolvedValue({
                status: 0,
                data_filetag: { id: 42, name: "Meetings" },
            }),
            updateFiletag: vi.fn().mockResolvedValue({ status: 0 }),
            deleteFiletag: vi.fn().mockResolvedValue({ status: 0 }),
            updateFileTags: vi.fn().mockResolvedValue({ status: 0 }),
            ...clientOverrides,
        },
        persistWorkspaceId: vi.fn().mockResolvedValue(undefined),
    };
}

describe("filetag routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (requireApiSession as unknown as Mock).mockResolvedValue({
            user: { id: USER_ID },
        });
    });

    it("returns 401 when unauthenticated", async () => {
        (requireApiSession as unknown as Mock).mockRejectedValue(
            new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401),
        );

        const response = await listFiletagsRoute(
            request("/api/filetags", undefined, "GET"),
        );

        expect(response.status).toBe(401);
    });

    it("lists filetags with per-directory counts", async () => {
        queueSelects([
            [tagRow()],
            [
                { filetagId: "tag-1", count: 3 },
                { filetagId: null, count: 5 },
            ],
        ]);

        const response = await listFiletagsRoute(
            request("/api/filetags", undefined, "GET"),
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            filetags: { id: string; name: string; isLocalOnly: boolean }[];
            counts: Record<string, number>;
        };
        expect(body.filetags).toHaveLength(1);
        expect(body.filetags[0].name).toBe("Meetings");
        expect(body.filetags[0].isLocalOnly).toBe(false);
        expect(body.counts["tag-1"]).toBe(3);
        expect(body.counts.unorganized).toBe(5);
    });

    describe("POST /api/filetags", () => {
        it("rejects a missing name", async () => {
            const response = await createFiletagRoute(
                request("/api/filetags", { icon: "iconfont_folder_meeting" }),
            );
            expect(response.status).toBe(400);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it("rejects colors outside the official palette", async () => {
            const response = await createFiletagRoute(
                request("/api/filetags", { name: "X", color: "#123456" }),
            );
            expect(response.status).toBe(400);
        });

        it("rejects unknown icons", async () => {
            const response = await createFiletagRoute(
                request("/api/filetags", { name: "X", icon: "not-an-icon" }),
            );
            expect(response.status).toBe(400);
        });

        it("rejects case-insensitive duplicate names locally", async () => {
            queueSelects([[tagRow({ name: "Meetings" })]]);

            const response = await createFiletagRoute(
                request("/api/filetags", { name: "  meetings " }),
            );

            expect(response.status).toBe(409);
            expect(getPlaudClientForUser).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it("creates a local-only directory without a Plaud connection", async () => {
            queueSelects([[]]);
            const inserted = captureInserts();
            (getPlaudClientForUser as Mock).mockResolvedValue(null);

            const response = await createFiletagRoute(
                request("/api/filetags", { name: "Personal" }),
            );

            expect(response.status).toBe(201);
            expect(inserted[0].plaudTagId).toBeNull();
            const body = (await response.json()) as {
                filetag: { isLocalOnly: boolean };
            };
            expect(body.filetag.isLocalOnly).toBe(true);
        });

        it("writes through to Plaud and stores the stringified tag id", async () => {
            queueSelects([[]]);
            const inserted = captureInserts();
            const handle = plaudHandle();
            (getPlaudClientForUser as Mock).mockResolvedValue(handle);

            const response = await createFiletagRoute(
                request("/api/filetags", {
                    name: "Meetings",
                    icon: "iconfont_folder_meeting",
                    color: "#4c8eff",
                }),
            );

            expect(response.status).toBe(201);
            expect(handle.client.createFiletag).toHaveBeenCalledWith({
                name: "Meetings",
                icon: "iconfont_folder_meeting",
                color: "#4c8eff",
            });
            expect(inserted[0].plaudTagId).toBe("42");
        });

        it("leaves the DB untouched when Plaud rejects the create", async () => {
            queueSelects([[]]);
            captureInserts();
            (getPlaudClientForUser as Mock).mockResolvedValue(
                plaudHandle({
                    createFiletag: vi
                        .fn()
                        .mockRejectedValue(
                            new AppError(
                                ErrorCode.ALREADY_EXISTS,
                                "duplicate",
                                409,
                            ),
                        ),
                }),
            );

            const response = await createFiletagRoute(
                request("/api/filetags", { name: "Meetings" }),
            );

            expect(response.status).toBe(409);
            expect(db.insert).not.toHaveBeenCalled();
        });
    });

    describe("PATCH/DELETE /api/filetags/[id]", () => {
        it("404s for a directory the user does not own", async () => {
            queueSelects([[]]);

            const response = await patchFiletagRoute(
                request("/api/filetags/tag-x", { name: "New" }, "PATCH"),
                idContext("tag-x"),
            );

            expect(response.status).toBe(404);
        });

        it("409s a Plaud-backed edit when no connection exists", async () => {
            // 1: load row, 2: duplicate-name check
            queueSelects([[tagRow()], []]);
            captureUpdates();
            (getPlaudClientForUser as Mock).mockResolvedValue(null);

            const response = await patchFiletagRoute(
                request("/api/filetags/tag-1", { name: "New" }, "PATCH"),
                idContext("tag-1"),
            );

            expect(response.status).toBe(409);
            expect(db.update).not.toHaveBeenCalled();
        });

        it("merges partial updates into the full Plaud body", async () => {
            queueSelects([[tagRow()], []]);
            captureUpdates();
            const handle = plaudHandle();
            (getPlaudClientForUser as Mock).mockResolvedValue(handle);

            const response = await patchFiletagRoute(
                request("/api/filetags/tag-1", { name: "Renamed" }, "PATCH"),
                idContext("tag-1"),
            );

            expect(response.status).toBe(200);
            // Plaud PATCH is full-body: untouched icon/color come from the row.
            expect(handle.client.updateFiletag).toHaveBeenCalledWith("9", {
                name: "Renamed",
                icon: "iconfont_folder_meeting",
                color: "#4c8eff",
            });
        });

        it("deletes on Plaud first, then locally", async () => {
            queueSelects([[tagRow()]]);
            const deletes = captureDeletes();
            const handle = plaudHandle();
            (getPlaudClientForUser as Mock).mockResolvedValue(handle);

            const response = await deleteFiletagRoute(
                request("/api/filetags/tag-1", undefined, "DELETE"),
                idContext("tag-1"),
            );

            expect(response.status).toBe(200);
            expect(handle.client.deleteFiletag).toHaveBeenCalledWith("9");
            expect(deletes).toHaveLength(1);
        });

        it("keeps the local row when the Plaud delete fails", async () => {
            queueSelects([[tagRow()]]);
            const deletes = captureDeletes();
            (getPlaudClientForUser as Mock).mockResolvedValue(
                plaudHandle({
                    deleteFiletag: vi
                        .fn()
                        .mockRejectedValue(
                            new AppError(
                                ErrorCode.PLAUD_UPSTREAM_ERROR,
                                "down",
                                502,
                            ),
                        ),
                }),
            );

            const response = await deleteFiletagRoute(
                request("/api/filetags/tag-1", undefined, "DELETE"),
                idContext("tag-1"),
            );

            expect(response.status).toBe(502);
            expect(deletes).toHaveLength(0);
        });
    });

    describe("POST /api/recordings/filetag", () => {
        it("validates recordingIds", async () => {
            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: [],
                    filetagId: null,
                }),
            );
            expect(response.status).toBe(400);
        });

        it("moves a mix of Plaud and local recordings with one Plaud call", async () => {
            // 1: target tag, 2: recordings
            queueSelects([
                [tagRow()],
                [
                    { id: "rec-1", plaudFileId: "plaud-file-1" },
                    { id: "rec-2", plaudFileId: "uploaded-abc" },
                ],
            ]);
            const updates = captureUpdates();
            const handle = plaudHandle();
            (getPlaudClientForUser as Mock).mockResolvedValue(handle);

            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: ["rec-1", "rec-2"],
                    filetagId: "tag-1",
                }),
            );

            expect(response.status).toBe(200);
            const body = (await response.json()) as { moved: number };
            expect(body.moved).toBe(2);
            // Only the Plaud-backed file id goes upstream.
            expect(handle.client.updateFileTags).toHaveBeenCalledTimes(1);
            expect(handle.client.updateFileTags).toHaveBeenCalledWith(
                ["plaud-file-1"],
                "9",
            );
            expect(updates[0].filetagId).toBe("tag-1");
            expect(emitEvent).toHaveBeenCalledTimes(2);
        });

        it("moves local-only recordings without any Plaud call", async () => {
            queueSelects([
                [tagRow({ plaudTagId: null })],
                [{ id: "rec-2", plaudFileId: "uploaded-abc" }],
            ]);
            const updates = captureUpdates();

            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: ["rec-2"],
                    filetagId: "tag-1",
                }),
            );

            expect(response.status).toBe(200);
            expect(getPlaudClientForUser).not.toHaveBeenCalled();
            expect(updates[0].filetagId).toBe("tag-1");
        });

        it("409s assigning a local-only tag to Plaud-backed recordings", async () => {
            queueSelects([
                [tagRow({ plaudTagId: null })],
                [{ id: "rec-1", plaudFileId: "plaud-file-1" }],
            ]);
            captureUpdates();

            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: ["rec-1"],
                    filetagId: "tag-1",
                }),
            );

            expect(response.status).toBe(409);
            expect(getPlaudClientForUser).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
        });

        it("clears the assignment on Plaud with an empty filetag id", async () => {
            queueSelects([[{ id: "rec-1", plaudFileId: "plaud-file-1" }]]);
            const updates = captureUpdates();
            const handle = plaudHandle();
            (getPlaudClientForUser as Mock).mockResolvedValue(handle);

            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: ["rec-1"],
                    filetagId: null,
                }),
            );

            expect(response.status).toBe(200);
            expect(handle.client.updateFileTags).toHaveBeenCalledWith(
                ["plaud-file-1"],
                "",
            );
            expect(updates[0].filetagId).toBeNull();
        });

        it("leaves the DB untouched when the Plaud move fails", async () => {
            queueSelects([
                [tagRow()],
                [{ id: "rec-1", plaudFileId: "plaud-file-1" }],
            ]);
            captureUpdates();
            (getPlaudClientForUser as Mock).mockResolvedValue(
                plaudHandle({
                    updateFileTags: vi
                        .fn()
                        .mockRejectedValue(
                            new AppError(
                                ErrorCode.PLAUD_UPSTREAM_ERROR,
                                "down",
                                502,
                            ),
                        ),
                }),
            );

            const response = await moveRecordingsRoute(
                request("/api/recordings/filetag", {
                    recordingIds: ["rec-1"],
                    filetagId: "tag-1",
                }),
            );

            expect(response.status).toBe(502);
            expect(db.update).not.toHaveBeenCalled();
            expect(emitEvent).not.toHaveBeenCalled();
        });
    });
});
