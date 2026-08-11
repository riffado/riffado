/**
 * Pins same-process in-flight dedup in `syncRecordingsForUser`.
 *
 * Why: two concurrent POST /api/plaud/sync calls for the same user that
 * land in the same Next.js worker (multi-tab, retry, parallel curl) used to
 * each paginate Plaud and download recordings through Webshare. They now
 * share a single in-flight promise; the second call returns the same
 * result with `inProgress: true` and triggers zero extra Plaud round-trips.
 *
 * Multi-process correctness (across hosted workers) is handled by the
 * per-user rate limit at the route boundary, tested separately.
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
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

const USER_ID = "user-dedup";

/**
 * Build a select() chain that always resolves to a non-empty connection
 * but an empty user-settings + user lookup. Lets the sync proceed past the
 * preamble and into the (mocked) plaud client.
 */
function wireSelectChain() {
    const connectionRow = {
        id: "conn-1",
        userId: USER_ID,
        bearerToken: "enc-token",
        apiBase: "https://api.plaud.ai",
        workspaceId: "ws-1",
    };
    let call = 0;
    (db.select as Mock).mockImplementation(() => ({
        from: () => ({
            where: () => ({
                limit: () => {
                    call += 1;
                    // 1: plaudConnections, 2: userSettings, 3: users
                    if (call === 1) return Promise.resolve([connectionRow]);
                    return Promise.resolve([]);
                },
            }),
        }),
    }));
}

function wireUpdateChain() {
    (db.update as Mock).mockReturnValue({
        set: () => ({ where: () => Promise.resolve() }),
    });
}

describe("syncRecordingsForUser in-process dedup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("coalesces concurrent calls into one Plaud round-trip", async () => {
        wireSelectChain();
        wireUpdateChain();

        // Mock client: getRecordings returns one empty page, slowly, so
        // both concurrent calls overlap on the same in-flight promise.
        const getRecordings = vi.fn().mockImplementation(
            () =>
                new Promise((resolve) => {
                    setTimeout(() => resolve({ data_file_list: [] }), 20);
                }),
        );
        (createPlaudClient as Mock).mockResolvedValue({
            listFiletags: vi
                .fn()
                .mockResolvedValue({ status: 0, data_filetag_list: [] }),
            getRecordings,
            workspaceId: "ws-1",
            usingUserTokenFallback: false,
        });

        const [a, b] = await Promise.all([
            syncRecordingsForUser(USER_ID),
            syncRecordingsForUser(USER_ID),
        ]);

        // Both callers got a result, but Plaud was only paginated once.
        expect(getRecordings).toHaveBeenCalledTimes(1);
        // createPlaudClient itself runs once for the shared run.
        expect(createPlaudClient).toHaveBeenCalledTimes(1);

        // Exactly one of the two carries `inProgress: true`. We don't
        // pin which one (race) — only that the dedup marker is present
        // on exactly the second-to-resolve caller's view.
        const inProgressFlags = [a.inProgress, b.inProgress].filter(
            (v) => v === true,
        );
        expect(inProgressFlags).toHaveLength(1);
    });

    it("releases the in-flight slot after completion so subsequent calls run fresh", async () => {
        wireSelectChain();
        wireUpdateChain();

        const getRecordings = vi.fn().mockResolvedValue({ data_file_list: [] });
        (createPlaudClient as Mock).mockResolvedValue({
            listFiletags: vi
                .fn()
                .mockResolvedValue({ status: 0, data_filetag_list: [] }),
            getRecordings,
            workspaceId: "ws-1",
            usingUserTokenFallback: false,
        });

        const first = await syncRecordingsForUser(USER_ID);
        // Re-wire the select chain — the first run consumed it.
        wireSelectChain();
        const second = await syncRecordingsForUser(USER_ID);

        expect(first.inProgress).toBeUndefined();
        expect(second.inProgress).toBeUndefined();
        expect(createPlaudClient).toHaveBeenCalledTimes(2);
    });

    it("releases the in-flight slot on error so users are not wedged", async () => {
        wireSelectChain();
        // No update wire-up needed; the run errors before reaching it.
        (createPlaudClient as Mock).mockRejectedValueOnce(new Error("boom"));

        const errored = await syncRecordingsForUser(USER_ID);
        expect(errored.errors.length).toBeGreaterThan(0);

        // A subsequent call must start a fresh run, not get stuck on a
        // dangling rejected promise.
        wireSelectChain();
        wireUpdateChain();
        (createPlaudClient as Mock).mockResolvedValueOnce({
            listFiletags: vi
                .fn()
                .mockResolvedValue({ status: 0, data_filetag_list: [] }),
            getRecordings: vi.fn().mockResolvedValue({ data_file_list: [] }),
            workspaceId: "ws-1",
            usingUserTokenFallback: false,
        });
        const next = await syncRecordingsForUser(USER_ID);
        expect(next.inProgress).toBeUndefined();
        expect(next.errors).toEqual([]);
    });
});
