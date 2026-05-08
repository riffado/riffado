import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted to the top of the file, so the factory must construct
// its own state. We expose handles via vi.hoisted so tests can reach in
// and re-wire chainable returns per-test.
const { dbMock } = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));

vi.mock("@/db/schema", () => {
    // Stable references; actions code compares by drizzle's column-proxy
    // identity in the real module. Stubs are enough for unit testing.
    return {
        users: { id: "users.id" },
        plaudConnections: { userId: "plaudConnections.userId" },
        recordings: { id: "recordings.id" },
        adminActionLog: {},
    };
});

import {
    forceDisconnectPlaud,
    softDeleteRecording,
    suspendUser,
    unsuspendUser,
} from "@/lib/admin/actions";
import { ErrorCode } from "@/lib/errors";

function makeChainable(result: unknown[]) {
    // Drizzle queries are thenable: `await db.select().from().where()`
    // works even without a terminal `.limit()`. Mirror that by giving the
    // chain its own `.then()` so awaits resolve to the result regardless
    // of which method ends the call (`.limit`, `.where`, `.orderBy`).
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.set = vi.fn().mockReturnValue(chain);
    chain.values = vi.fn().mockResolvedValue(undefined);
    // Drizzle queries are explicitly thenable so awaits resolve
    // regardless of which method is terminal in the chain (`limit`,
    // `where`, `orderBy`). The mock mirrors that. Defined via
    // Object.defineProperty so we control descriptor flags.
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable
    Object.defineProperty(chain, "then", {
        value: (
            onFulfilled: (v: unknown[]) => unknown,
            onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
        enumerable: true,
    });
    return chain;
}

/**
 * Builds a `tx` mock whose select/update/insert calls record into the
 * passed-in spy maps so tests can introspect what happened. Returns a
 * `transaction` impl suitable for `dbMock.transaction.mockImplementation`.
 */
function makeTransactionImpl(opts: {
    selectResult: unknown[];
    selectAllResult?: unknown[];
}) {
    const insertCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    let selectIndex = 0;
    const selectResults = opts.selectAllResult
        ? [opts.selectResult, opts.selectAllResult]
        : [opts.selectResult];

    const transaction = vi
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => unknown) => {
            const tx = {
                select: vi.fn().mockImplementation(() => {
                    const r =
                        selectResults[
                            Math.min(selectIndex++, selectResults.length - 1)
                        ];
                    return makeChainable(r);
                }),
                update: vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockImplementation((args) => {
                            updateCalls.push(args);
                            return Promise.resolve(undefined);
                        }),
                    }),
                }),
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockImplementation((args) => {
                        insertCalls.push(args);
                        return Promise.resolve(undefined);
                    }),
                }),
                delete: vi.fn().mockReturnValue({
                    where: vi.fn().mockImplementation((args) => {
                        deleteCalls.push(args);
                        return Promise.resolve(undefined);
                    }),
                }),
            };
            return cb(tx);
        });
    return { transaction, insertCalls, updateCalls, deleteCalls };
}

const baseCtx = {
    adminUserId: "admin1",
    adminUserEmail: "ops@example.com",
    ip: null as string | null,
    reason: "",
};

describe("admin actions reason guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("suspendUser rejects empty reason", async () => {
        await expect(suspendUser(baseCtx, "u1")).rejects.toMatchObject({
            code: ErrorCode.MISSING_REQUIRED_FIELD,
        });
    });

    it("unsuspendUser rejects short reason", async () => {
        await expect(
            unsuspendUser({ ...baseCtx, reason: "ab" }, "u1"),
        ).rejects.toMatchObject({ code: ErrorCode.MISSING_REQUIRED_FIELD });
    });

    it("forceDisconnectPlaud rejects empty reason", async () => {
        await expect(forceDisconnectPlaud(baseCtx, "u1")).rejects.toMatchObject(
            { code: ErrorCode.MISSING_REQUIRED_FIELD },
        );
    });

    it("softDeleteRecording rejects empty reason", async () => {
        await expect(softDeleteRecording(baseCtx, "r1")).rejects.toMatchObject({
            code: ErrorCode.MISSING_REQUIRED_FIELD,
        });
    });
});

describe("suspendUser happy path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("writes audit log and updates user when not already suspended", async () => {
        const harness = makeTransactionImpl({
            selectResult: [
                {
                    id: "u1",
                    email: "x@y",
                    suspendedAt: null,
                    suspendedReason: null,
                },
            ],
        });
        dbMock.transaction.mockImplementation(harness.transaction);

        const res = await suspendUser(
            { ...baseCtx, ip: "1.2.3.4", reason: "abuse: bulk imports" },
            "u1",
        );

        expect(res.ok).toBe(true);
        expect(res.alreadySuspended).toBe(false);
        expect(harness.insertCalls).toHaveLength(1);
        const auditRow = harness.insertCalls[0] as {
            action: string;
            adminUserId: string | null;
            adminUserEmail: string;
            targetUserId: string;
            reason: string;
        };
        expect(auditRow.action).toBe("suspend_user");
        expect(auditRow.adminUserId).toBe("admin1");
        expect(auditRow.adminUserEmail).toBe("ops@example.com");
        expect(auditRow.targetUserId).toBe("u1");
        expect(auditRow.reason).toBe("abuse: bulk imports");
    });

    it("logs a noop row when the user is already suspended (idempotent path)", async () => {
        const existingSuspendedAt = new Date("2026-01-01T00:00:00Z");
        const harness = makeTransactionImpl({
            selectResult: [
                {
                    id: "u1",
                    email: "x@y",
                    suspendedAt: existingSuspendedAt,
                    suspendedReason: "earlier",
                },
            ],
        });
        dbMock.transaction.mockImplementation(harness.transaction);

        const res = await suspendUser(
            { ...baseCtx, reason: "duplicate suspend attempt" },
            "u1",
        );

        expect(res.alreadySuspended).toBe(true);
        // No update should run on the idempotent path.
        expect(harness.updateCalls).toHaveLength(0);
        // But a noop audit row IS written.
        expect(harness.insertCalls).toHaveLength(1);
        expect((harness.insertCalls[0] as { action: string }).action).toBe(
            "suspend_user_noop",
        );
    });
});

describe("forceDisconnectPlaud counts every deleted row", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns deleted=N when N rows existed and logs the full set", async () => {
        const harness = makeTransactionImpl({
            selectResult: [
                {
                    id: "pc1",
                    apiBase: "https://api.plaud.ai",
                    plaudEmail: "a@x",
                    lastSync: null,
                },
                {
                    id: "pc2",
                    apiBase: "https://api-euc1.plaud.ai",
                    plaudEmail: "a@x",
                    lastSync: new Date(),
                },
            ],
        });
        dbMock.transaction.mockImplementation(harness.transaction);

        const res = await forceDisconnectPlaud(
            { ...baseCtx, reason: "fraudulent connection" },
            "u1",
        );
        expect(res.deleted).toBe(2);
        expect(harness.insertCalls).toHaveLength(1);
        const audit = harness.insertCalls[0] as {
            action: string;
            before: { count: number; connections: unknown[] };
        };
        expect(audit.action).toBe("force_disconnect_plaud");
        expect(audit.before.count).toBe(2);
        expect(audit.before.connections).toHaveLength(2);
    });

    it("logs a noop and returns deleted=0 when no connection exists", async () => {
        const harness = makeTransactionImpl({ selectResult: [] });
        dbMock.transaction.mockImplementation(harness.transaction);

        const res = await forceDisconnectPlaud(
            { ...baseCtx, reason: "no connection here" },
            "u1",
        );
        expect(res.deleted).toBe(0);
        const audit = harness.insertCalls[0] as { action: string };
        expect(audit.action).toBe("force_disconnect_plaud_noop");
    });
});
