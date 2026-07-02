import { beforeEach, describe, expect, it, vi } from "vitest";

const { entitlementsMock, queriesMock } = vi.hoisted(() => ({
    entitlementsMock: { getEntitlements: vi.fn() },
    queriesMock: {
        getUserStorageBytes: vi.fn(),
        reserveMynahSeconds: vi.fn(),
        refundMynahSeconds: vi.fn(),
    },
}));

vi.mock("@/lib/entitlements", () => entitlementsMock);
vi.mock("@/db/queries/billing", () => queriesMock);

import {
    canStoreMoreBytes,
    commitMynahReservation,
    releaseMynahReservation,
    reserveMynah,
} from "@/lib/hosted/billing/enforcement";

describe("canStoreMoreBytes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("allows unlimited storage for plans with null cap (self-host)", async () => {
        entitlementsMock.getEntitlements.mockResolvedValue({
            plan: "self_host",
            maxStorageBytes: null,
        });
        const result = await canStoreMoreBytes("u1", 1024);
        expect(result.allowed).toBe(true);
        expect(result.limitBytes).toBeNull();
        expect(queriesMock.getUserStorageBytes).not.toHaveBeenCalled();
    });

    it("allows when current + additional fits under the cap", async () => {
        entitlementsMock.getEntitlements.mockResolvedValue({
            plan: "hosted_free",
            maxStorageBytes: 5_000_000_000,
        });
        queriesMock.getUserStorageBytes.mockResolvedValue(1_000_000_000);
        const result = await canStoreMoreBytes("u1", 500_000_000);
        expect(result.allowed).toBe(true);
        expect(result.currentBytes).toBe(1_000_000_000);
        expect(result.limitBytes).toBe(5_000_000_000);
    });

    it("denies when current + additional exceeds the cap", async () => {
        entitlementsMock.getEntitlements.mockResolvedValue({
            plan: "hosted_free",
            maxStorageBytes: 5_000_000_000,
        });
        queriesMock.getUserStorageBytes.mockResolvedValue(4_900_000_000);
        const result = await canStoreMoreBytes("u1", 200_000_000);
        expect(result.allowed).toBe(false);
    });

    it("allows exactly at the cap boundary (== limit)", async () => {
        entitlementsMock.getEntitlements.mockResolvedValue({
            plan: "hosted_free",
            maxStorageBytes: 1000,
        });
        queriesMock.getUserStorageBytes.mockResolvedValue(900);
        const result = await canStoreMoreBytes("u1", 100);
        expect(result.allowed).toBe(true);
    });

    it("clamps negative additionalBytes to 0 (never falsely allows due to bad input)", async () => {
        entitlementsMock.getEntitlements.mockResolvedValue({
            plan: "hosted_free",
            maxStorageBytes: 1000,
        });
        queriesMock.getUserStorageBytes.mockResolvedValue(1500);
        const result = await canStoreMoreBytes("u1", -999);
        expect(result.allowed).toBe(false);
        expect(result.currentBytes).toBe(1500);
    });
});

describe("Mynah reservation lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns reserved=true when seconds were atomically subtracted", async () => {
        queriesMock.reserveMynahSeconds.mockResolvedValue(true);
        const r = await reserveMynah({ userId: "u1", seconds: 60 });
        expect(r.reserved).toBe(true);
        expect(r.seconds).toBe(60);
    });

    it("returns reserved=false when counter is below requested seconds", async () => {
        queriesMock.reserveMynahSeconds.mockResolvedValue(false);
        const r = await reserveMynah({ userId: "u1", seconds: 60 });
        expect(r.reserved).toBe(false);
    });

    it("commit is a no-op (seconds stay subtracted)", () => {
        commitMynahReservation({ userId: "u1", seconds: 60, reserved: true });
        expect(queriesMock.refundMynahSeconds).not.toHaveBeenCalled();
    });

    it("release refunds when reserved=true", async () => {
        queriesMock.refundMynahSeconds.mockResolvedValue(undefined);
        await releaseMynahReservation({
            userId: "u1",
            seconds: 60,
            reserved: true,
        });
        expect(queriesMock.refundMynahSeconds).toHaveBeenCalledWith({
            userId: "u1",
            seconds: 60,
        });
    });

    it("release is a no-op when reserved=false (nothing to refund)", async () => {
        await releaseMynahReservation({
            userId: "u1",
            seconds: 60,
            reserved: false,
        });
        expect(queriesMock.refundMynahSeconds).not.toHaveBeenCalled();
    });
});
