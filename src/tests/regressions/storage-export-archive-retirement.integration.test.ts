/**
 * Regression: export archives piling up in object storage.
 *
 * Retention is 7 days but the rebuild cooldown is 24 hours, and
 * `completeExportJob` never retired a user's older completed archives,
 * so one user could hold about seven full-library zips at once. Account
 * deletion also never looked at `export_jobs`, whose rows cascade with
 * the user, orphaning every archive object.
 *
 * After the fix:
 *   1. Completing a job expires the same user's older completed archives
 *      now (the worker's cleanup pass then deletes them); the archive that
 *      just completed stays downloadable, other users are untouched, and a
 *      superseded claim retires nothing.
 *   2. `listExportStorageKeysForUser` returns every key the user's jobs
 *      may have written, scoped to that user.
 *   3. A failure recorded after a job completed (late failure for the
 *      same claim) never flips it back: completion clears the claim
 *      token and the failure write only matches `processing` jobs.
 */

import { eq } from "drizzle-orm";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { exportJobs, users } from "@/db/schema";
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

import {
    completeExportJob,
    EXPORT_ARCHIVE_RETENTION_MS,
    getRecentCompletedExportJobForUser,
    isExportArchiveReferenced,
    listExportStorageKeysForUser,
    reclaimStaleProcessingExportJobs,
    recordExportJobFailure,
    selectExpiredExportJobs,
} from "@/db/queries/export-jobs";
import { exportArchiveStorageKey } from "@/lib/export/storage-key";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeWithDatabase("export archive retirement PostgreSQL integration", () => {
    let database: TestPostgresDatabase | null = null;

    function db() {
        if (!database) throw new Error("test database was not initialized");
        return database.db;
    }

    async function insertCompleted(input: {
        id: string;
        userId: string;
        completedDaysAgo: number;
    }) {
        const completedAt = new Date(
            Date.now() - input.completedDaysAgo * DAY_MS,
        );
        await db()
            .insert(exportJobs)
            .values({
                id: input.id,
                userId: input.userId,
                status: "completed",
                claimToken: `token-${input.id}`,
                storageKey: `exports/${input.userId}/${input.id}-token-${input.id}.zip`,
                fileSize: 100,
                recordingCount: 1,
                createdAt: completedAt,
                startedAt: completedAt,
                completedAt,
                expiresAt: new Date(
                    completedAt.getTime() + EXPORT_ARCHIVE_RETENTION_MS,
                ),
            });
    }

    async function insertProcessing(id: string, userId: string) {
        await db().insert(exportJobs).values({
            id,
            userId,
            status: "processing",
            claimToken: "live-token",
            startedAt: new Date(),
        });
    }

    async function expiresAtOf(id: string): Promise<Date | null> {
        const [row] = await db()
            .select({ expiresAt: exportJobs.expiresAt })
            .from(exportJobs)
            .where(eq(exportJobs.id, id));
        return row?.expiresAt ?? null;
    }

    beforeAll(async () => {
        database = await createMigratedTestDatabase(
            testDatabaseUrl ?? "",
            "export_retirement",
        );
        dbRef.current = database.db as unknown as Record<PropertyKey, unknown>;
    }, 120_000);

    afterAll(async () => {
        dbRef.current = null;
        await database?.dispose();
    }, 30_000);

    beforeEach(async () => {
        await db().delete(exportJobs);
        await db().delete(users);
        await db()
            .insert(users)
            .values([
                { id: "user-a", email: "a@example.com" },
                { id: "user-b", email: "b@example.com" },
            ]);
    });

    it("expires the user's older completed archives when a new one completes", async () => {
        await insertCompleted({
            id: "old-1",
            userId: "user-a",
            completedDaysAgo: 3,
        });
        await insertCompleted({
            id: "old-2",
            userId: "user-a",
            completedDaysAgo: 1,
        });
        await insertCompleted({
            id: "other-user",
            userId: "user-b",
            completedDaysAgo: 1,
        });
        await insertProcessing("new", "user-a");

        const completed = await completeExportJob({
            jobId: "new",
            userId: "user-a",
            claimToken: "live-token",
            storageKey: "exports/user-a/new-live-token.zip",
            fileSize: 200,
            recordingCount: 2,
        });

        expect(completed).toBe(true);
        const now = Date.now();
        expect((await expiresAtOf("old-1"))?.getTime()).toBeLessThanOrEqual(
            now,
        );
        expect((await expiresAtOf("old-2"))?.getTime()).toBeLessThanOrEqual(
            now,
        );
        expect((await expiresAtOf("new"))?.getTime()).toBeGreaterThan(
            now + EXPORT_ARCHIVE_RETENTION_MS - DAY_MS,
        );
        expect((await expiresAtOf("other-user"))?.getTime()).toBeGreaterThan(
            now,
        );

        const recent = await getRecentCompletedExportJobForUser("user-a");
        expect(recent?.id).toBe("new");

        const expired = await selectExpiredExportJobs(10);
        expect(expired.map((job) => job.id).sort()).toEqual(["old-1", "old-2"]);
    });

    it("retires nothing when the claim was superseded, so the older archive stays downloadable", async () => {
        await insertCompleted({
            id: "old",
            userId: "user-a",
            completedDaysAgo: 2,
        });
        await insertProcessing("new", "user-a");
        const before = await expiresAtOf("old");

        const completed = await completeExportJob({
            jobId: "new",
            userId: "user-a",
            claimToken: "stale-token",
            storageKey: "exports/user-a/new-stale-token.zip",
            fileSize: 200,
            recordingCount: 2,
        });

        expect(completed).toBe(false);
        expect(await expiresAtOf("old")).toEqual(before);
        const recent = await getRecentCompletedExportJobForUser("user-a");
        expect(recent?.id).toBe("old");
    });

    it("does not complete or retire anything for a job id passed with another user's id", async () => {
        await insertCompleted({
            id: "old",
            userId: "user-a",
            completedDaysAgo: 2,
        });
        await insertProcessing("new", "user-a");
        const before = await expiresAtOf("old");

        const completed = await completeExportJob({
            jobId: "new",
            userId: "user-b",
            claimToken: "live-token",
            storageKey: "exports/user-b/new-live-token.zip",
            fileSize: 200,
            recordingCount: 2,
        });

        expect(completed).toBe(false);
        expect(await expiresAtOf("old")).toEqual(before);
    });

    it("leaves an archive that already expired with its original expiry", async () => {
        await insertCompleted({
            id: "ancient",
            userId: "user-a",
            completedDaysAgo: 10,
        });
        await insertProcessing("new", "user-a");
        const before = await expiresAtOf("ancient");

        await completeExportJob({
            jobId: "new",
            userId: "user-a",
            claimToken: "live-token",
            storageKey: "exports/user-a/new-live-token.zip",
            fileSize: 200,
            recordingCount: 2,
        });

        expect(await expiresAtOf("ancient")).toEqual(before);
    });

    it("lists every export key of one user: archives, claimed or failed attempts and stale keys", async () => {
        await insertCompleted({
            id: "done",
            userId: "user-a",
            completedDaysAgo: 1,
        });
        await insertProcessing("building", "user-a");
        await db()
            .insert(exportJobs)
            .values({
                id: "reclaimed",
                userId: "user-a",
                status: "failed",
                claimToken: "dead",
                staleStorageKeys: [
                    "exports/user-a/reclaimed-crashed-1.zip",
                    "exports/user-a/reclaimed-crashed-2.zip",
                ],
            });
        await insertCompleted({
            id: "b-done",
            userId: "user-b",
            completedDaysAgo: 1,
        });

        const keys = await listExportStorageKeysForUser("user-a");

        expect(keys.sort()).toEqual(
            [
                "exports/user-a/building-live-token.zip",
                "exports/user-a/done-token-done.zip",
                "exports/user-a/reclaimed-crashed-1.zip",
                "exports/user-a/reclaimed-crashed-2.zip",
                "exports/user-a/reclaimed-dead.zip",
            ].sort(),
        );
    });

    it("requeues a failed processing attempt, then fails it permanently after the attempt limit", async () => {
        await insertProcessing("job", "user-a");

        expect(
            await recordExportJobFailure("job", "live-token", "blip"),
        ).toEqual({ status: "pending", attempts: 1 });
        const [requeued] = await db()
            .select()
            .from(exportJobs)
            .where(eq(exportJobs.id, "job"));
        expect(requeued?.claimToken).toBeNull();

        await db()
            .update(exportJobs)
            .set({ status: "processing", claimToken: "t2", attempts: 2 })
            .where(eq(exportJobs.id, "job"));
        expect(
            await recordExportJobFailure("job", "t2", "still broken"),
        ).toEqual({ status: "failed", attempts: 3 });
    });

    it("never flips a completed job back when a late failure arrives for its claim", async () => {
        await insertProcessing("new", "user-a");
        expect(
            await completeExportJob({
                jobId: "new",
                userId: "user-a",
                claimToken: "live-token",
                storageKey: "exports/user-a/new-live-token.zip",
                fileSize: 200,
                recordingCount: 2,
            }),
        ).toBe(true);

        expect(
            await recordExportJobFailure("new", "live-token", "late"),
        ).toBeNull();

        const [row] = await db()
            .select()
            .from(exportJobs)
            .where(eq(exportJobs.id, "new"));
        expect(row?.status).toBe("completed");
        expect(row?.claimToken).toBeNull();
        expect(row?.errorMessage).toBeNull();
        expect(row?.storageKey).toBe("exports/user-a/new-live-token.zip");
    });

    it("ignores a late failure for a completed row that still holds its claim token", async () => {
        await insertCompleted({
            id: "done",
            userId: "user-a",
            completedDaysAgo: 1,
        });

        expect(
            await recordExportJobFailure("done", "token-done", "late"),
        ).toBeNull();

        const [row] = await db()
            .select({
                status: exportJobs.status,
                attempts: exportJobs.attempts,
            })
            .from(exportJobs)
            .where(eq(exportJobs.id, "done"));
        expect(row).toEqual({ status: "completed", attempts: 0 });
    });

    it("reports a completed archive as referenced only for its own user and key", async () => {
        await insertCompleted({
            id: "done",
            userId: "user-a",
            completedDaysAgo: 1,
        });
        const storageKey = "exports/user-a/done-token-done.zip";

        expect(
            await isExportArchiveReferenced({
                jobId: "done",
                userId: "user-a",
                storageKey,
            }),
        ).toBe(true);
        expect(
            await isExportArchiveReferenced({
                jobId: "done",
                userId: "user-b",
                storageKey,
            }),
        ).toBe(false);
        expect(
            await isExportArchiveReferenced({
                jobId: "done",
                userId: "user-a",
                storageKey: "exports/user-a/done-other.zip",
            }),
        ).toBe(false);
    });

    it("derives attempt keys in SQL exactly as the worker names them", async () => {
        await db()
            .insert(exportJobs)
            .values({
                id: "crashed",
                userId: "user-a",
                status: "processing",
                claimToken: "zombie",
                startedAt: new Date(Date.now() - DAY_MS),
            });
        const workerKey = exportArchiveStorageKey({
            userId: "user-a",
            jobId: "crashed",
            claimToken: "zombie",
        });
        expect(workerKey).toBe("exports/user-a/crashed-zombie.zip");

        expect(await listExportStorageKeysForUser("user-a")).toEqual([
            workerKey,
        ]);

        expect(await reclaimStaleProcessingExportJobs(60_000)).toBe(1);
        const [row] = await db()
            .select({ staleStorageKeys: exportJobs.staleStorageKeys })
            .from(exportJobs)
            .where(eq(exportJobs.id, "crashed"));
        expect(row?.staleStorageKeys).toEqual([workerKey]);
    });
});
