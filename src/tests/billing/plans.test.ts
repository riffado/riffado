import { describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        IS_HOSTED: true,
        BILLING_FREE_INCLUDED_SECONDS: 1800,
        BILLING_PRO_INCLUDED_SECONDS: 54_000,
        STRIPE_PRICE_ID_USD: "price_usd_found",
        STRIPE_PRICE_ID_EUR: "price_eur_found",
        STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard",
        STRIPE_STANDARD_PRICE_ID_EUR: "price_eur_standard",
        STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
        STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year",
        STRIPE_LEGACY_PRO_PRICE_IDS: ["price_legacy"],
        BILLING_PRICE_USD: "5.00",
        BILLING_PRICE_EUR: "5.00",
        BILLING_STANDARD_PRICE_USD: "10.00",
        BILLING_STANDARD_PRICE_EUR: "10.00",
        BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
        BILLING_LAUNCH_DATE: undefined as string | undefined,
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ users: {} }));

import { isWithinFoundingWindow } from "@/lib/hosted/billing/checkout";
import { entitlementsForSubscription } from "@/lib/hosted/billing/plans";

describe("entitlementsForSubscription price gate", () => {
    it.each([
        "price_usd_found",
        "price_eur_found",
        "price_usd_standard",
        "price_eur_standard",
        "price_usd_year",
        "price_eur_year",
        "price_legacy",
    ])("matches configured Pro price id %s to hosted_pro", (priceId) => {
        const entry = entitlementsForSubscription({
            status: "active",
            priceId,
        });
        expect(entry.plan).toBe("hosted_pro");
        expect(entry.entitlements.maxStorageBytes).toBe(
            50 * 1024 * 1024 * 1024,
        );
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
            priceId: "price_eur_found",
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
            priceId: "price_eur_found",
        });
        expect(entry.plan).toBe("hosted_free");
    });
});

describe("isWithinFoundingWindow legacy guard", () => {
    it("is closed because founding pricing is capacity-based", () => {
        expect(isWithinFoundingWindow(new Date("2026-03-15T12:00:00Z"))).toBe(
            false,
        );
    });
});
