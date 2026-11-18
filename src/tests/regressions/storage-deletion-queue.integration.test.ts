/**
 * Regression: failed storage deletes were dropped silently.
 *
 * Account deletion removed recording audio best-effort and only logged
 * failures before deleting the user row, so any object whose delete
 * failed stayed in the bucket with nothing left pointing at it.
 *
 * After the fix, `deleteUser` re-reads the user's recording paths and
 * export keys under lock and queues every key that was not deleted
 * beforehand (and every export key, since an export in flight while the
 * keys were deleted may have written its object since) in
 * `storage_deletion_queue`, in the same transaction as the user-row
 * delete. An export that completes, or is claimed, between the listing
 * and the user-row delete therefore ends up queued. The export worker
 * retries them: claims are exclusive across processes, retries are
 * bounded, and an object that is already gone counts as deleted.
 *
 * Follow-ups: re-queueing a key that gave up (`failed`) makes it pending
 * again with fresh attempts, rows are due by the app's UTC clock rather
 * than the database session's `now()`, operators get pending/failed
 * counts, and error tracking never receives the storage key (it embeds
 * the user id). `deleteUser` locks the user row before collecting keys,
 * so a recording insert that races it waits and then fails on the user
 * FK instead of landing after the scan.
 */

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import * as schema from "@/db/schema";
import {
    exportJobs,
    recordings,
    storageDeletionQueue,
    users,
} from "@/db/schema";
import { captureServerException } from "@/lib/posthog-server";
import type { StorageProvider } from "@/lib/storage/types";
import {
    createMigratedTestDatabase,
    getTestDatabaseUrl,
    type TestPostgresDatabase,
} from "@/tests/integration/postgres";

const { dbProxy, dbRef } = vi.hoisted(() => {
    const ref: { current: Record<PropertyKey, unknown> | null } = {
        current: null,
    };
    const proxy = new Proxy(
        {},
        {
            get: (_target, property: string | symbol) => {
                const current = ref.current;
                if (!current) {
                    throw new Error("test database was not initialized");
                }
                const value = current[property];
                return typeof value === "function"
                    ? value.bind(current)
                    : value;
            },
        },
    );
    return { dbProxy: proxy, dbRef: ref };
});

vi.mock("@/db", () => ({ db: dbProxy }));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: vi.fn() }));

const { storageRef } = vi.hoisted(() => ({
    storageRef: { current: null as unknown },
}));

vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => storageRef.current,
}));
vi.mock("@/lib/notifications/email", () => ({
    sendAccountDeletedEmail: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: {} }));

import { deleteUser } from "@/db/queries/billing";
import { completeExportJob } from "@/db/queries/export-jobs";
import {
    claimDueStorageDeletions,
    completeStorageDeletion,
    countStorageDeletionQueue,
    enqueueStorageDeletions,
    failStorageDeletion,
} from "@/db/queries/storage-deletions";
import { deleteUserAccount } from "@/lib/hosted/billing/deletion";
import {
    STORAGE_DELETION_MAX_ATTEMPTS,
    sweepStorageDeletionQueue,
} from "@/lib/storage/deletion-queue";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function fakeStorage(deleteFile: (key: string) => Promise<void>) {
    return { deleteFile } as unknown as StorageProvider;
}

function recordingRow(userId: string, storagePath: string) {
    return {
        userId,
        deviceSn: "SN",
        plaudFileId: storagePath,
        filename: "f",
        duration: 1000,
        startTime: new Date("2026-01-01T00:00:00Z"),
        endTime: new Date("2026-01-01T00:00:01Z"),
        filesize: 10,
        fileMd5: "0".repeat(32),
        storageType: "s3",
        storagePath,
        plaudVersion: "1",
    };
}

describeWithDatabase("storage deletion queue PostgreSQL integration", () => {
    let database: TestPostgresDatabase | null = null;

    function db() {
        if (!database) throw new Error("test database was not initialized");
        return database.db;
    }

    async function queueRows() {
        return db()
            .select()
            .from(storageDeletionQueue)
            .orderBy(storageDeletionQueue.storageKey);
    }

    beforeAll(async () => {
        database = await createMigratedTestDatabase(
            testDatabaseUrl ?? "",
            "storage_deletion_queue",
        );
        dbRef.current = database.db as unknown as Record<PropertyKey, unknown>;
    }, 120_000);

    afterAll(async () => {
        dbRef.current = null;
        await database?.dispose();
    }, 30_000);

    beforeEach(async () => {
        await db().delete(storageDeletionQueue);
        await db().delete(exportJobs);
        await db().delete(recordings);
        await db().delete(users);
    });

    async function insertRecording(userId: string, storagePath: string) {
        await db().insert(recordings).values(recordingRow(userId, storagePath));
    }

    async function waitForLockWaiter() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const [row] = await db().execute<{ waiting: number }>(
                sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
            );
            if (Number(row?.waiting ?? 0) > 0) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("no backend started waiting on a lock");
    }

    it("makes a recording insert that races the deletion wait for it, then fail on the user FK", async () => {
        if (!database) throw new Error("test database was not initialized");
        await db().insert(users).values({ id: "gone", email: "g@example.com" });
        await insertRecording("gone", "gone/a.ogg");
        await db().insert(exportJobs).values({
            id: "job",
            userId: "gone",
            status: "completed",
            storageKey: "exports/gone/job-t.zip",
        });
        const blocker = postgres(database.url, { max: 1 });
        const writerClient = postgres(database.url, { max: 1 });
        const writer = drizzle(writerClient, { schema });
        let releaseBlocker = () => {};
        const blockerReleased = new Promise<void>((resolve) => {
            releaseBlocker = resolve;
        });
        let markLocked = () => {};
        const blockerLocked = new Promise<void>((resolve) => {
            markLocked = resolve;
        });
        const blockerTx = blocker.begin(async (tx) => {
            await tx`select id from export_jobs where id = 'job' for update`;
            markLocked();
            await blockerReleased;
        });
        try {
            await blockerLocked;
            const deletion = deleteUser("gone");
            await waitForLockWaiter();

            let insertSettled = false;
            const insert = writer
                .insert(recordings)
                .values(recordingRow("gone", "gone/late.ogg"))
                .then(
                    () => null,
                    (error: unknown) => error,
                )
                .finally(() => {
                    insertSettled = true;
                });
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(insertSettled).toBe(false);

            releaseBlocker();
            await blockerTx;
            await deletion;
            const insertError = (await insert) as {
                code?: string;
                cause?: { code?: string };
            } | null;
            expect(insertError?.code ?? insertError?.cause?.code).toBe("23503");

            expect(await db().select().from(recordings)).toEqual([]);
            const rows = await queueRows();
            expect(rows.map((row) => row.storageKey)).toEqual([
                "exports/gone/job-t.zip",
                "gone/a.ogg",
            ]);
        } finally {
            releaseBlocker();
            await blockerTx.catch(() => {});
            await blocker.end({ timeout: 5 });
            await writerClient.end({ timeout: 5 });
        }
    });

    it("queues every key not deleted beforehand in the same transaction that deletes the user", async () => {
        await db().insert(users).values({ id: "gone", email: "g@example.com" });
        await insertRecording("gone", "gone/a.ogg");
        await insertRecording("gone", "gone/b.ogg");
        await db().insert(exportJobs).values({
            id: "job",
            userId: "gone",
            status: "completed",
            storageKey: "exports/gone/job-t.zip",
        });

        await deleteUser("gone", {
            deletedStorageKeys: ["gone/a.ogg", "exports/gone/job-t.zip"],
        });

        expect(
            await db().select().from(users).where(eq(users.id, "gone")),
        ).toEqual([]);
        expect(await db().select().from(exportJobs)).toEqual([]);
        const rows = await queueRows();
        expect(rows.map((row) => [row.storageKey, row.source])).toEqual([
            ["exports/gone/job-t.zip", "account_deletion"],
            ["gone/b.ogg", "account_deletion"],
        ]);
    });

    it("queues an export that completed, and one that was claimed, after the keys were listed", async () => {
        await db()
            .insert(users)
            .values([
                { id: "gone", email: "g@example.com" },
                { id: "other", email: "o@example.com" },
            ]);
        await insertRecording("gone", "gone/a.ogg");
        await db()
            .insert(exportJobs)
            .values([
                {
                    id: "building",
                    userId: "gone",
                    status: "processing",
                    claimToken: "t1",
                    startedAt: new Date(),
                },
                {
                    id: "other-job",
                    userId: "other",
                    status: "completed",
                    storageKey: "exports/other/other-job-x.zip",
                },
            ]);
        const deleted: string[] = [];
        storageRef.current = fakeStorage(async (key) => {
            deleted.push(key);
            if (deleted.length > 1) return;
            await completeExportJob({
                jobId: "building",
                userId: "gone",
                claimToken: "t1",
                storageKey: "exports/gone/building-t1.zip",
                fileSize: 1,
                recordingCount: 1,
                retireOlderArchives: true,
            });
            await db().insert(exportJobs).values({
                id: "queued",
                userId: "gone",
                status: "processing",
                claimToken: "t2",
                startedAt: new Date(),
            });
        });

        const result = await deleteUserAccount("gone");

        expect(result.storageErrors).toBe(0);
        expect(deleted.sort()).toEqual(
            ["exports/gone/building-t1.zip", "gone/a.ogg"].sort(),
        );
        const rows = await queueRows();
        expect(rows.map((row) => row.storageKey)).toEqual([
            "exports/gone/building-t1.zip",
            "exports/gone/queued-t2.zip",
        ]);
        expect(
            await db()
                .select({ id: exportJobs.id })
                .from(exportJobs)
                .where(eq(exportJobs.userId, "other")),
        ).toEqual([{ id: "other-job" }]);
    });

    it("keeps the user row and its recordings when queueing the keys it could not delete fails", async () => {
        await db().insert(users).values({ id: "stay", email: "s@example.com" });
        await insertRecording("stay", "stay/a.ogg");
        await db().execute(
            sql.raw(
                "create function riffado_test_fail_queue() returns trigger language plpgsql as $$ begin raise exception 'queue unavailable'; end $$",
            ),
        );
        await db().execute(
            sql.raw(
                "create trigger riffado_test_fail_queue before insert on storage_deletion_queue for each row execute function riffado_test_fail_queue()",
            ),
        );
        storageRef.current = fakeStorage(async () => {
            throw new Error("S3 503");
        });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const failure = await deleteUserAccount("stay").catch(
                (caught: unknown) => caught,
            );
            expect(
                String((failure as Error | undefined)?.cause ?? failure),
            ).toContain("queue unavailable");
        } finally {
            error.mockRestore();
            await db().execute(
                sql.raw(
                    "drop trigger riffado_test_fail_queue on storage_deletion_queue",
                ),
            );
            await db().execute(
                sql.raw("drop function riffado_test_fail_queue()"),
            );
        }

        expect(
            await db()
                .select({ id: users.id })
                .from(users)
                .where(eq(users.id, "stay")),
        ).toEqual([{ id: "stay" }]);
        expect(
            (
                await db()
                    .select({ storagePath: recordings.storagePath })
                    .from(recordings)
            ).map((row) => row.storagePath),
        ).toEqual(["stay/a.ogg"]);
        expect(await queueRows()).toEqual([]);
    });

    it("enqueue is idempotent per key", async () => {
        await enqueueStorageDeletions(["k1", "k1", "k2"], "export_cleanup");
        await enqueueStorageDeletions(["k1"], "account_deletion");

        const rows = await queueRows();
        expect(rows.map((row) => [row.storageKey, row.source])).toEqual([
            ["k1", "export_cleanup"],
            ["k2", "export_cleanup"],
        ]);
    });

    it("never hands the same key to two concurrent claimers, and leases claimed keys", async () => {
        await enqueueStorageDeletions(
            ["k1", "k2", "k3", "k4", "k5"],
            "account_deletion",
        );

        const [first, second] = await Promise.all([
            claimDueStorageDeletions({ limit: 3, leaseMs: 60_000 }),
            claimDueStorageDeletions({ limit: 3, leaseMs: 60_000 }),
        ]);
        const claimedKeys = [...first, ...second].map(
            (entry) => entry.storageKey,
        );
        expect(new Set(claimedKeys).size).toBe(claimedKeys.length);
        expect(claimedKeys.length).toBe(5);

        const again = await claimDueStorageDeletions({
            limit: 10,
            leaseMs: 60_000,
        });
        expect(again).toEqual([]);
    });

    it("completes only for the claim that holds the key", async () => {
        await enqueueStorageDeletions(["k1"], "account_deletion");
        const [claim] = await claimDueStorageDeletions({
            limit: 1,
            leaseMs: 60_000,
        });

        expect(
            await completeStorageDeletion({
                storageKey: "k1",
                claimToken: "someone-else",
            }),
        ).toBe(false);
        expect(
            await completeStorageDeletion({
                storageKey: "k1",
                claimToken: claim.claimToken,
            }),
        ).toBe(true);
        expect(await queueRows()).toEqual([]);
    });

    it("reschedules failures and stops retrying after the attempt limit", async () => {
        await enqueueStorageDeletions(["k1"], "account_deletion");

        for (let attempt = 1; attempt <= 3; attempt++) {
            const [claim] = await claimDueStorageDeletions({
                limit: 1,
                leaseMs: 60_000,
            });
            const outcome = await failStorageDeletion({
                storageKey: "k1",
                claimToken: claim.claimToken,
                errorMessage: `boom ${attempt}`,
                maxAttempts: 3,
                retryAt: new Date(Date.now() - 1000),
            });
            expect(outcome).toEqual({
                status: attempt < 3 ? "pending" : "failed",
                attempts: attempt,
            });
        }

        const [row] = await queueRows();
        expect(row.status).toBe("failed");
        expect(row.lastError).toBe("boom 3");
        expect(
            await claimDueStorageDeletions({ limit: 1, leaseMs: 60_000 }),
        ).toEqual([]);
    });

    it("does not make a failed key due again before its retry time", async () => {
        await enqueueStorageDeletions(["k1"], "account_deletion");
        const [claim] = await claimDueStorageDeletions({
            limit: 1,
            leaseMs: 1,
        });
        await failStorageDeletion({
            storageKey: "k1",
            claimToken: claim.claimToken,
            errorMessage: "boom",
            maxAttempts: 5,
            retryAt: new Date(Date.now() + 60_000),
        });

        expect(
            await claimDueStorageDeletions({ limit: 1, leaseMs: 60_000 }),
        ).toEqual([]);
    });

    it("sweep deletes queued objects, treats a missing object as deleted, and retries other failures", async () => {
        await enqueueStorageDeletions(
            ["present", "missing", "flaky"],
            "account_deletion",
        );
        const deleted: string[] = [];
        const storage = fakeStorage(async (key) => {
            if (key === "missing") {
                throw new Error("Failed to delete file from local storage", {
                    cause: Object.assign(new Error("ENOENT"), {
                        code: "ENOENT",
                    }),
                });
            }
            if (key === "flaky") throw new Error("S3 503");
            deleted.push(key);
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await sweepStorageDeletionQueue(storage);
        warn.mockRestore();

        expect(result).toEqual({ deleted: 2, retrying: 1, failed: 0 });
        expect(deleted).toEqual(["present"]);
        const rows = await queueRows();
        expect(rows.map((row) => [row.storageKey, row.attempts])).toEqual([
            ["flaky", 1],
        ]);
        expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("sweep gives up after the attempt limit and keeps the row for an operator", async () => {
        await enqueueStorageDeletions(["flaky"], "account_deletion");
        await db()
            .update(storageDeletionQueue)
            .set({ attempts: STORAGE_DELETION_MAX_ATTEMPTS - 1 });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await sweepStorageDeletionQueue(
            fakeStorage(async () => {
                throw new Error("S3 503");
            }),
        );
        error.mockRestore();

        expect(result).toEqual({ deleted: 0, retrying: 0, failed: 1 });
        const [row] = await queueRows();
        expect(row.status).toBe("failed");
        expect(row.attempts).toBe(STORAGE_DELETION_MAX_ATTEMPTS);
    });

    it("reports a give-up to error tracking without the storage key", async () => {
        const key = "user-secret-id/rec.ogg";
        await enqueueStorageDeletions([key], "account_deletion");
        await db()
            .update(storageDeletionQueue)
            .set({ attempts: STORAGE_DELETION_MAX_ATTEMPTS - 1 });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(captureServerException).mockClear();

        await sweepStorageDeletionQueue(
            fakeStorage(async (storageKey) => {
                throw new Error(
                    `EACCES: permission denied, unlink '/data/${storageKey}'`,
                );
            }),
        );
        error.mockRestore();

        expect(captureServerException).toHaveBeenCalledTimes(1);
        const [captured, properties] = vi.mocked(captureServerException).mock
            .calls[0];
        expect(JSON.stringify(properties)).not.toContain("user-secret-id");
        expect((captured as Error).message).not.toContain("user-secret-id");
        expect((captured as Error).message).toContain("EACCES");
    });

    it("re-queueing a key that gave up makes it pending and due again with fresh attempts", async () => {
        await enqueueStorageDeletions(["k1"], "export_cleanup");
        await db()
            .update(storageDeletionQueue)
            .set({
                status: "failed",
                attempts: STORAGE_DELETION_MAX_ATTEMPTS,
                nextAttemptAt: new Date(Date.now() + 60 * 60_000),
                lastError: "S3 503",
            });

        await enqueueStorageDeletions(["k1"], "account_deletion");

        const [row] = await queueRows();
        expect(row.status).toBe("pending");
        expect(row.attempts).toBe(0);
        const claimed = await claimDueStorageDeletions({
            limit: 1,
            leaseMs: 60_000,
        });
        expect(claimed.map((entry) => entry.storageKey)).toEqual(["k1"]);
    });

    it("re-queueing a pending key keeps its attempts and schedule", async () => {
        await enqueueStorageDeletions(["k1"], "export_cleanup");
        const retryAt = new Date(Date.now() + 60 * 60_000);
        await db()
            .update(storageDeletionQueue)
            .set({ attempts: 2, nextAttemptAt: retryAt });

        await enqueueStorageDeletions(["k1"], "account_deletion");

        const [row] = await queueRows();
        expect(row.attempts).toBe(2);
        expect(row.nextAttemptAt).toEqual(retryAt);
    });

    it("counts pending and failed rows for operators", async () => {
        await enqueueStorageDeletions(["k1", "k2", "k3"], "account_deletion");
        await db()
            .update(storageDeletionQueue)
            .set({ status: "failed" })
            .where(eq(storageDeletionQueue.storageKey, "k3"));

        expect(await countStorageDeletionQueue()).toEqual({
            pending: 2,
            failed: 1,
        });
    });

    it("makes queued keys due by the app clock even when the database session is not on UTC", async () => {
        if (!database) throw new Error("test database was not initialized");
        const offsetClient = postgres(database.url, {
            max: 1,
            connection: { TimeZone: "Pacific/Kiritimati" },
        });
        const previous = dbRef.current;
        dbRef.current = drizzle(offsetClient, {
            schema,
        }) as unknown as Record<PropertyKey, unknown>;
        try {
            const before = Date.now();
            await enqueueStorageDeletions(["k1"], "account_deletion");
            const after = Date.now();
            const [row] = await queueRows();
            expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
                before - 1000,
            );
            expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(
                after + 1000,
            );
            const claimed = await claimDueStorageDeletions({
                limit: 1,
                leaseMs: 60_000,
            });
            expect(claimed.map((entry) => entry.storageKey)).toEqual(["k1"]);
        } finally {
            dbRef.current = previous;
            await offsetClient.end({ timeout: 5 });
        }
    });
});
