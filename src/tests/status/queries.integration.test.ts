import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    statusJobRuns,
    statusMinuteBuckets,
    stripeWebhookEvents,
} from "@/db/schema";
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
    addStatusBucketCounts,
    getStatusJobRun,
    getStripeInboxHealth,
    listStatusBuckets,
    mergeStatusJobRun,
    pingDatabase,
    pruneStatusBuckets,
    setStatusMinuteVerdict,
} from "@/db/queries/status";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MINUTE = new Date("2026-11-18T10:04:00.000Z");
const at = (iso: string) => new Date(iso);

describeWithDatabase("status queries PostgreSQL integration", () => {
    let database: TestPostgresDatabase | null = null;

    beforeAll(async () => {
        database = await createMigratedTestDatabase(
            testDatabaseUrl ?? "",
            "status_queries",
        );
        dbRef.current = database.db as unknown as Record<PropertyKey, unknown>;
    }, 120_000);

    afterAll(async () => {
        dbRef.current = null;
        await database?.dispose();
    }, 30_000);

    beforeEach(async () => {
        if (!database) throw new Error("test database was not initialized");
        await database.db.delete(statusMinuteBuckets);
        await database.db.delete(statusJobRuns);
        await database.db.delete(stripeWebhookEvents);
    });

    it("sums two processes' counts and histograms for the same minute", async () => {
        await addStatusBucketCounts({
            part: "plaud",
            minute: MINUTE,
            ok: 3,
            err: 1,
            latencyBuckets: [2, 1, 0, 1],
        });
        await Promise.all([
            addStatusBucketCounts({
                part: "plaud",
                minute: MINUTE,
                ok: 5,
                err: 0,
                latencyBuckets: [4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            }),
            addStatusBucketCounts({
                part: "plaud",
                minute: MINUTE,
                ok: 1,
                err: 2,
                latencyBuckets: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
            }),
        ]);

        const rows = await listStatusBuckets("plaud", MINUTE);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            minute: MINUTE,
            ok: 9,
            err: 3,
            latencyBuckets: [6, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        });
    });

    it("stores per-state verdict reasons next to the counts", async () => {
        await setStatusMinuteVerdict({
            part: "storage",
            minute: MINUTE,
            state: "down",
            reason: "probe-failed",
        });
        await setStatusMinuteVerdict({
            part: "storage",
            minute: MINUTE,
            state: "ok",
            reason: "probe-ok",
        });
        await addStatusBucketCounts({
            part: "storage",
            minute: MINUTE,
            ok: 2,
            err: 0,
            latencyBuckets: [2],
        });

        const [row] = await listStatusBuckets("storage", MINUTE);
        expect(row).toMatchObject({
            ok: 2,
            latencyBuckets: [2],
            verdictOk: "probe-ok",
            verdictSlow: null,
            verdictDown: "probe-failed",
        });
        expect(
            await listStatusBuckets(
                "storage",
                new Date(MINUTE.getTime() + 60_000),
            ),
        ).toEqual([]);
    });

    it("prunes buckets older than the cutoff", async () => {
        const old = new Date(MINUTE.getTime() - 25 * 60 * 60_000);
        for (const minute of [old, MINUTE]) {
            await addStatusBucketCounts({
                part: "emails",
                minute,
                ok: 1,
                err: 0,
                latencyBuckets: [1],
            });
        }
        await pruneStatusBuckets(new Date(MINUTE.getTime() - 24 * 60 * 60_000));
        const rows = await listStatusBuckets("emails", old);
        expect(rows.map((r) => r.minute)).toEqual([MINUTE]);
    });

    it("merges job outcomes across processes and tracks the failure streak", async () => {
        expect(await getStatusJobRun("auto-transcribe")).toBeNull();

        await mergeStatusJobRun({
            job: "auto-transcribe",
            lastSuccessAt: null,
            lastErrorAt: at("2026-11-18T10:00:00Z"),
            failingFrom: at("2026-11-18T10:00:00Z"),
        });
        await mergeStatusJobRun({
            job: "auto-transcribe",
            lastSuccessAt: null,
            lastErrorAt: at("2026-11-18T10:05:00Z"),
            failingFrom: at("2026-11-18T10:04:00Z"),
        });
        expect(await getStatusJobRun("auto-transcribe")).toEqual({
            lastSuccessAt: null,
            lastErrorAt: at("2026-11-18T10:05:00Z"),
            failingSince: at("2026-11-18T10:00:00Z"),
        });

        await mergeStatusJobRun({
            job: "auto-transcribe",
            lastSuccessAt: at("2026-11-18T10:06:00Z"),
            lastErrorAt: at("2026-11-18T10:07:00Z"),
            failingFrom: at("2026-11-18T10:07:00Z"),
        });
        expect(await getStatusJobRun("auto-transcribe")).toEqual({
            lastSuccessAt: at("2026-11-18T10:06:00Z"),
            lastErrorAt: at("2026-11-18T10:07:00Z"),
            failingSince: at("2026-11-18T10:07:00Z"),
        });

        await mergeStatusJobRun({
            job: "auto-transcribe",
            lastSuccessAt: at("2026-11-18T10:08:00Z"),
            lastErrorAt: null,
            failingFrom: null,
        });
        expect(await getStatusJobRun("auto-transcribe")).toEqual({
            lastSuccessAt: at("2026-11-18T10:08:00Z"),
            lastErrorAt: at("2026-11-18T10:07:00Z"),
            failingSince: null,
        });

        await mergeStatusJobRun({
            job: "auto-transcribe",
            lastSuccessAt: at("2026-11-18T09:00:00Z"),
            lastErrorAt: null,
            failingFrom: null,
        });
        expect(
            (await getStatusJobRun("auto-transcribe"))?.lastSuccessAt,
        ).toEqual(at("2026-11-18T10:08:00Z"));
    });

    it("reports the Stripe inbox backlog and recent permanent failures", async () => {
        if (!database) throw new Error("test database was not initialized");
        const base = {
            type: "invoice.paid",
            eventCreatedAt: at("2026-11-18T09:00:00Z"),
        };
        await database.db.insert(stripeWebhookEvents).values([
            {
                ...base,
                eventId: "evt_pending_old",
                status: "pending",
                createdAt: at("2026-11-18T09:40:00Z"),
            },
            {
                ...base,
                eventId: "evt_processing",
                status: "processing",
                createdAt: at("2026-11-18T09:55:00Z"),
            },
            {
                ...base,
                eventId: "evt_failed_recent",
                status: "failed",
                failedAt: at("2026-11-18T08:00:00Z"),
                createdAt: at("2026-11-18T07:00:00Z"),
            },
            {
                ...base,
                eventId: "evt_failed_old",
                status: "failed",
                failedAt: at("2026-11-16T08:00:00Z"),
                createdAt: at("2026-11-16T07:00:00Z"),
            },
            {
                ...base,
                eventId: "evt_done",
                status: "completed",
                createdAt: at("2026-11-18T06:00:00Z"),
            },
        ]);

        expect(await getStripeInboxHealth(at("2026-11-17T10:00:00Z"))).toEqual({
            open: 2,
            oldestOpenAt: at("2026-11-18T09:40:00Z"),
            failedSince: 1,
        });

        await database.db.delete(stripeWebhookEvents);
        expect(await getStripeInboxHealth(at("2026-11-17T10:00:00Z"))).toEqual({
            open: 0,
            oldestOpenAt: null,
            failedSince: 0,
        });
    });

    it("pings the database", async () => {
        await expect(pingDatabase()).resolves.toBeUndefined();
    });
});
