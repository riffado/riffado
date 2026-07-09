import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const { dbMock, envMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    envMock: {
        IS_HOSTED: false,
        BILLING_FREE_INCLUDED_SECONDS: 1800,
        BILLING_PRO_INCLUDED_SECONDS: 54_000,
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: {
        id: "users.id",
        plan: "users.plan",
        planTransitionUntil: "users.planTransitionUntil",
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    entitlementsForPlan,
    getEntitlements,
    isHostedLockedOut,
} from "@/lib/entitlements";

function makeChainable(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    return chain;
}

describe("entitlementsForPlan (static)", () => {
    it("self_host: unlimited storage, unlimited devices, 0 Mynah", () => {
        const e = entitlementsForPlan("self_host");
        expect(e.plan).toBe("self_host");
        expect(e.maxStorageBytes).toBeNull();
        expect(e.maxDevices).toBeNull();
        expect(e.monthlyMynahSeconds).toBe(0);
    });

    it("hosted_free: lockout state, all caps zero", () => {
        const e = entitlementsForPlan("hosted_free");
        expect(e.plan).toBe("hosted_free");
        expect(e.maxStorageBytes).toBe(0);
        expect(e.maxDevices).toBe(0);
        expect(e.monthlyMynahSeconds).toBe(0);
    });

    it("hosted_pro: 50GB cap, unlimited devices, env-driven Mynah seconds", () => {
        const e = entitlementsForPlan("hosted_pro");
        expect(e.plan).toBe("hosted_pro");
        expect(e.maxStorageBytes).toBe(50 * 1024 * 1024 * 1024);
        expect(e.maxDevices).toBeNull();
        expect(e.monthlyMynahSeconds).toBe(
            envMock.BILLING_PRO_INCLUDED_SECONDS,
        );
    });
});

describe("getEntitlements (DB-backed)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = false;
    });

    it("returns self_host when IS_HOSTED is false (no DB read)", async () => {
        envMock.IS_HOSTED = false;
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("self_host");
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("returns hosted_free when no users row exists (just-deleted user race)", async () => {
        envMock.IS_HOSTED = true;
        (dbMock.select as Mock).mockReturnValue(makeChainable([]));
        const e = await getEntitlements("missing");
        expect(e.plan).toBe("hosted_free");
    });

    it("returns plan-mapped entitlements when not in transition window", async () => {
        envMock.IS_HOSTED = true;
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro", planTransitionUntil: null }]),
        );
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("hosted_pro");
    });

    it("treats NULL plan as hosted_free when transition window is closed", async () => {
        envMock.IS_HOSTED = true;
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: null, planTransitionUntil: null }]),
        );
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("hosted_free");
    });

    it("upgrades hosted_free → hosted_pro entitlements while transition window is open", async () => {
        envMock.IS_HOSTED = true;
        const future = new Date(Date.now() + 86400 * 1000);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([
                { plan: "hosted_free", planTransitionUntil: future },
            ]),
        );
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("hosted_pro");
        expect(e.maxStorageBytes).toBe(50 * 1024 * 1024 * 1024);
    });

    it("does NOT change anything when user is already hosted_pro and in transition window", async () => {
        envMock.IS_HOSTED = true;
        const future = new Date(Date.now() + 86400 * 1000);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([
                { plan: "hosted_pro", planTransitionUntil: future },
            ]),
        );
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("hosted_pro");
    });

    it("ignores expired planTransitionUntil and returns the real plan", async () => {
        envMock.IS_HOSTED = true;
        const past = new Date(Date.now() - 86400 * 1000);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_free", planTransitionUntil: past }]),
        );
        const e = await getEntitlements("u1");
        expect(e.plan).toBe("hosted_free");
    });
});

describe("isHostedLockedOut", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = false;
    });

    it("false on self-host (no DB read)", async () => {
        envMock.IS_HOSTED = false;
        expect(await isHostedLockedOut("u1")).toBe(false);
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("true for a lapsed hosted_free account", async () => {
        envMock.IS_HOSTED = true;
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_free", planTransitionUntil: null }]),
        );
        expect(await isHostedLockedOut("u1")).toBe(true);
    });

    it("false for hosted_pro", async () => {
        envMock.IS_HOSTED = true;
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([{ plan: "hosted_pro", planTransitionUntil: null }]),
        );
        expect(await isHostedLockedOut("u1")).toBe(false);
    });

    it("false while still inside the transition window", async () => {
        envMock.IS_HOSTED = true;
        const future = new Date(Date.now() + 86400 * 1000);
        (dbMock.select as Mock).mockReturnValue(
            makeChainable([
                { plan: "hosted_free", planTransitionUntil: future },
            ]),
        );
        expect(await isHostedLockedOut("u1")).toBe(false);
    });
});
