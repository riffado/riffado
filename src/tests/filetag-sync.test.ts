import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, ""),
    ),
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

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/hosted/billing/storage-cap", () => ({
    enforceStorageCap: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { db } from "@/db";
import { syncFiletagsForUser } from "@/lib/sync/sync-filetags";

const USER_ID = "user-1";

/**
 * Flexible fluent-chain mock: every db.select() call returns a thenable
 * chain (from/where/orderBy/groupBy/limit all chain) resolving to the
 * next queued result. Extra calls resolve to [].
 */
function queueSelects(results: unknown[][]) {
    let call = 0;
    (db.select as Mock).mockImplementation(() => {
        const result = call < results.length ? results[call] : [];
        call += 1;
        const chain: Record<string, unknown> = {};
        for (const method of [
            "from",
            "where",
            "orderBy",
            "groupBy",
            "limit",
            "for",
        ]) {
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
            const row = { id: `local-${inserted.length}`, ...values };
            return {
                onConflictDoNothing: () => ({
                    returning: () => Promise.resolve([row]),
                }),
                returning: () => Promise.resolve([row]),
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
            return { where: () => Promise.resolve() };
        },
    }));
    return updates;
}

function captureDeletes() {
    const deletes: number[] = [];
    (db.delete as Mock).mockImplementation(() => {
        deletes.push(deletes.length);
        return { where: () => Promise.resolve() };
    });
    return deletes;
}

function localRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "local-tag-1",
        userId: USER_ID,
        plaudTagId: "9",
        name: "encrypted-name", // legacy-plaintext shape: decryptText passes it through
        icon: "iconfont_folder_meeting",
        color: "#4c8eff",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

describe("syncFiletagsForUser", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("inserts new remote tags with normalized icon and stringified id", async () => {
        queueSelects([[]]);
        const inserted = captureInserts();
        captureUpdates();
        captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi.fn().mockResolvedValue({
                status: 0,
                data_filetag_list: [
                    // numeric id + legacy codepoint icon
                    {
                        id: 12,
                        name: "Meetings",
                        icon: "e607",
                        color: "#4c8eff",
                    },
                ],
            }),
        });

        expect(inserted).toHaveLength(1);
        expect(inserted[0].plaudTagId).toBe("12");
        expect(inserted[0].icon).toBe("iconfont_folder_meeting");
        expect(inserted[0].name).toBe("v1:encrypted:Meetings");
        expect(state.map.get("12")).toBe("local-1");
    });

    it("updates the mirror when name/icon/color changed on Plaud", async () => {
        queueSelects([[localRow({ name: "Meetings" })]]);
        captureInserts();
        const updates = captureUpdates();
        captureDeletes();

        await syncFiletagsForUser(USER_ID, {
            listFiletags: vi.fn().mockResolvedValue({
                status: 0,
                data_filetag_list: [
                    {
                        id: "9",
                        name: "Renamed",
                        icon: "iconfont_folder_meeting",
                        color: "#4c8eff",
                    },
                ],
            }),
        });

        expect(updates).toHaveLength(1);
        expect(updates[0].name).toBe("v1:encrypted:Renamed");
    });

    it("does not touch unchanged rows", async () => {
        queueSelects([[localRow({ name: "Meetings" })]]);
        captureInserts();
        const updates = captureUpdates();
        const deletes = captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi.fn().mockResolvedValue({
                status: 0,
                data_filetag_list: [
                    {
                        id: 9,
                        name: "Meetings",
                        icon: "iconfont_folder_meeting",
                        color: "#4c8eff",
                    },
                ],
            }),
        });

        expect(updates).toHaveLength(0);
        expect(deletes).toHaveLength(0);
        expect(state.map.get("9")).toBe("local-tag-1");
    });

    it("hard-deletes mirrored tags that disappeared from Plaud", async () => {
        queueSelects([[localRow()]]);
        captureInserts();
        captureUpdates();
        const deletes = captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi
                .fn()
                .mockResolvedValue({ status: 0, data_filetag_list: [] }),
        });

        expect(deletes).toHaveLength(1);
        expect(state.map.size).toBe(0);
    });

    it("never touches local-only rows and reports them in the state", async () => {
        const localOnly = localRow({
            id: "local-only-1",
            plaudTagId: null,
            name: "Personal",
        });
        queueSelects([[localOnly]]);
        captureInserts();
        const updates = captureUpdates();
        const deletes = captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi
                .fn()
                .mockResolvedValue({ status: 0, data_filetag_list: [] }),
        });

        expect(updates).toHaveLength(0);
        expect(deletes).toHaveLength(0);
        expect(state.localOnlyTagIds.has("local-only-1")).toBe(true);
    });

    it("degrades to the local mapping when Plaud errors, without failing", async () => {
        queueSelects([[localRow()]]);
        captureInserts();
        const updates = captureUpdates();
        const deletes = captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi.fn().mockRejectedValue(new Error("boom")),
        });

        expect(state.map.get("9")).toBe("local-tag-1");
        expect(updates).toHaveLength(0);
        expect(deletes).toHaveLength(0);
    });

    it("keeps the mirror as-is on non-zero Plaud status", async () => {
        queueSelects([[localRow()]]);
        captureInserts();
        captureUpdates();
        const deletes = captureDeletes();

        const state = await syncFiletagsForUser(USER_ID, {
            listFiletags: vi.fn().mockResolvedValue({ status: -1 }),
        });

        expect(deletes).toHaveLength(0);
        expect(state.map.get("9")).toBe("local-tag-1");
    });
});
