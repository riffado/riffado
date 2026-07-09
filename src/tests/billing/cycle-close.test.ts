import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const { dbMock, envMock, queriesMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    envMock: {
        IS_HOSTED: true,
        BILLING_ENABLED: true,
        BILLING_FREE_INCLUDED_SECONDS: 1800,
        BILLING_PRO_INCLUDED_SECONDS: 54_000,
    },
    queriesMock: {
        resetMynahCounterIfDue: vi.fn(),
        claimUsersDueForCycleClose: vi.fn(),
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: { id: "users.id", plan: "users.plan" },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db/queries/billing", () => queriesMock);

import {
    closeCycleForUser,
    closeDueCycles,
} from "@/lib/hosted/billing/cycle-close";

function makeChainable(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    return chain;
}

describe("closeCycleForUser", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns false when user does not exist", async () => {
        (dbMock.select as Mock).mockReturnValue(makeChainable([]));
        const result = await closeCycleForUser("missing");
        expect(result).toBe(false);
        expect(queriesMock.resetMynahCounterIfDue).not.toHaveBeenCalled();
    });

    it("grants the hosted_pro budget (54000s) and pushes the next reset 30 days forward", async () => {
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro" }]),
        );
        queriesMock.resetMynahCounterIfDue.mockResolvedValue(true);

        const before = Date.now();
        const result = await closeCycleForUser("u1");
        expect(result).toBe(true);

        const call = queriesMock.resetMynahCounterIfDue.mock.calls[0][0];
        expect(call.userId).toBe("u1");
        expect(call.grantSeconds).toBe(54_000);

        const diff = (call.nextResetAt as Date).getTime() - before;
        expect(diff).toBeGreaterThan(30 * 86400 * 1000 - 5_000);
        expect(diff).toBeLessThan(30 * 86400 * 1000 + 5_000);
    });

    it("treats NULL plan as hosted_free lockout (0s granted)", async () => {
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: null }]),
        );
        queriesMock.resetMynahCounterIfDue.mockResolvedValue(true);
        await closeCycleForUser("u1");
        const call = queriesMock.resetMynahCounterIfDue.mock.calls[0][0];
        expect(call.grantSeconds).toBe(0);
    });

    it("returns false when resetMynahCounterIfDue reports the row was already closed (concurrent worker)", async () => {
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro" }]),
        );
        queriesMock.resetMynahCounterIfDue.mockResolvedValue(false);
        const result = await closeCycleForUser("u1");
        expect(result).toBe(false);
    });
});

describe("closeDueCycles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 0 and writes nothing when no users are due", async () => {
        queriesMock.claimUsersDueForCycleClose.mockResolvedValue([]);
        const closed = await closeDueCycles();
        expect(closed).toBe(0);
    });

    it("counts only successful closes (concurrent worker losses skipped)", async () => {
        queriesMock.claimUsersDueForCycleClose.mockResolvedValue([
            "u1",
            "u2",
            "u3",
        ]);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro" }]),
        );
        queriesMock.resetMynahCounterIfDue
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        const closed = await closeDueCycles();
        expect(closed).toBe(2);
    });

    it("continues iterating when one user's close throws", async () => {
        queriesMock.claimUsersDueForCycleClose.mockResolvedValue(["u1", "u2"]);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro" }]),
        );
        queriesMock.resetMynahCounterIfDue
            .mockRejectedValueOnce(new Error("db blip"))
            .mockResolvedValueOnce(true);

        // Suppress the console.error from the caught error.
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const closed = await closeDueCycles();
        expect(closed).toBe(1);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});
