/**
 * Regression: failed storage deletes were dropped silently.
 *
 * Account deletion removed recording audio best-effort and only logged
 * failures before deleting the user row, so any object whose delete
 * failed stayed in the bucket with nothing left pointing at it.
 *
 * After the fix, failed keys are queued in `storage_deletion_queue` in
 * the same transaction as the user-row delete, and the export worker
 * retries them: claims are exclusive across processes, retries are
 * bounded, and an object that is already gone counts as deleted.
 *
 * Follow-ups: re-queueing a key that gave up (`failed`) makes it pending
 * again with fresh attempts, rows are due by the app's UTC clock rather
 * than the database session's `now()`, operators get pending/failed
 * counts, and error tracking never receives the storage key (it embeds
 * the user id).
 */

import { eq } from "drizzle-orm";
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
import { exportJobs, storageDeletionQueue, users } from "@/db/schema";
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

import { deleteUser } from "@/db/queries/billing";
import {
    claimDueStorageDeletions,
    completeStorageDeletion,
    countStorageDeletionQueue,
    enqueueStorageDeletions,
    failStorageDeletion,
} from "@/db/queries/storage-deletions";
import {
    STORAGE_DELETION_MAX_ATTEMPTS,
    sweepStorageDeletionQueue,
} from "@/lib/storage/deletion-queue";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function fakeStorage(deleteFile: (key: string) => Promise<void>) {
    return { deleteFile } as unknown as StorageProvider;
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
        await db().delete(users);
    });

    it("queues failed keys in the same transaction that deletes the user", async () => {
        await db().insert(users).values({ id: "gone", email: "g@example.com" });
        await db().insert(exportJobs).values({
            id: "job",
            userId: "gone",
            status: "completed",
            storageKey: "exports/gone/job-t.zip",
        });

        await deleteUser("gone", {
            pendingStorageKeys: ["gone/a.ogg", "exports/gone/job-t.zip"],
        });

        expect(
            await db().select().from(users).where(eq(users.id, "gone")),
        ).toEqual([]);
        expect(await db().select().from(exportJobs)).toEqual([]);
        const rows = await queueRows();
        expect(rows.map((row) => [row.storageKey, row.source])).toEqual([
            ["exports/gone/job-t.zip", "account_deletion"],
            ["gone/a.ogg", "account_deletion"],
        ]);
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
            await enqueueStorageDeletions(["k1"], "account_deletion");
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
