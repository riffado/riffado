import { describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        IS_HOSTED: true,
        BILLING_FREE_INCLUDED_SECONDS: 1800,
        BILLING_PRO_INCLUDED_SECONDS: 54_000,
        STRIPE_PRICE_ID_USD: "price_usd",
        STRIPE_PRICE_ID_EUR: "price_eur",
        BILLING_PRICE_USD: "5.00",
        BILLING_PRICE_EUR: "5.00",
        BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
        BILLING_LAUNCH_DATE: undefined as string | undefined,
        BILLING_FOUNDING_MEMBER_WINDOW_DAYS: undefined as number | undefined,
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ users: {} }));

import { isWithinFoundingWindow } from "@/lib/hosted/billing/checkout";
import { entitlementsForSubscription } from "@/lib/hosted/billing/plans";

describe("entitlementsForSubscription price gate", () => {
    it("matches a configured Pro price id to hosted_pro", () => {
        const entry = entitlementsForSubscription({
            status: "active",
            priceId: "price_eur",
        });
        expect(entry.plan).toBe("hosted_pro");
        expect(entry.entitlements.maxStorageBytes).toBe(
            50 * 1024 * 1024 * 1024,
        );
    });

    it("matches the USD Pro price id too", () => {
        const entry = entitlementsForSubscription({
            status: "active",
            priceId: "price_usd",
        });
        expect(entry.plan).toBe("hosted_pro");
    });

    it("falls back to hosted_free on an unknown price id (never escalates)", () => {
        const entry = entitlementsForSubscription({
            status: "active",
            priceId: "price_unknown",
        });
        expect(entry.plan).toBe("hosted_free");
    });

    it("falls back to hosted_free on a null price id", () => {
        const entry = entitlementsForSubscription({
            status: "active",
            priceId: null,
        });
        expect(entry.plan).toBe("hosted_free");
    });
});

describe("entitlementsForSubscription status gate", () => {
    it.each([
        "active",
        "trialing",
        "past_due",
    ])("returns hosted_pro for status=%s at a Pro price", (status) => {
        const entry = entitlementsForSubscription({
            status,
            priceId: "price_eur",
        });
        expect(entry.plan).toBe("hosted_pro");
    });

    it.each([
        "canceled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "paused",
    ])("returns hosted_free for status=%s regardless of price", (status) => {
        const entry = entitlementsForSubscription({
            status,
            priceId: "price_eur",
        });
        expect(entry.plan).toBe("hosted_free");
    });
});

describe("isWithinFoundingWindow", () => {
    it("returns false when BILLING_LAUNCH_DATE is unset", () => {
        envMock.BILLING_LAUNCH_DATE = undefined;
        expect(isWithinFoundingWindow()).toBe(false);
    });

    it("returns true within 6 months of launch", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-01-01";
        expect(isWithinFoundingWindow(new Date("2026-03-15T12:00:00Z"))).toBe(
            true,
        );
    });

    it("returns false before launch date", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-07-01";
        expect(isWithinFoundingWindow(new Date("2026-06-30T23:59:59Z"))).toBe(
            false,
        );
    });

    it("returns false after 6 months", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-01-01";
        expect(isWithinFoundingWindow(new Date("2026-07-01T00:00:00Z"))).toBe(
            false,
        );
    });
});
