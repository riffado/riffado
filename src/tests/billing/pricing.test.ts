import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        STRIPE_PRICE_ID_USD: "price_usd_found" as string | undefined,
        STRIPE_PRICE_ID_EUR: "price_eur_found" as string | undefined,
        STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard" as
            | string
            | undefined,
        STRIPE_STANDARD_PRICE_ID_EUR: "price_eur_standard" as
            | string
            | undefined,
        STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year" as string | undefined,
        STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year" as string | undefined,
        STRIPE_LEGACY_PRO_PRICE_IDS: ["price_legacy"],
        BILLING_PRICE_USD: "5.00",
        BILLING_PRICE_EUR: "5.00",
        BILLING_STANDARD_PRICE_USD: "9.00",
        BILLING_STANDARD_PRICE_EUR: "9.00",
        BILLING_PRICE_USD_ANNUAL: "50.00" as string | undefined,
        BILLING_PRICE_EUR_ANNUAL: "50.00" as string | undefined,
        BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    billingPriceCatalog,
    configuredProPriceIds,
    isFoundingMonthlyPriceId,
    isProPriceId,
    priceForCurrency,
    resolveCurrency,
    resolvePrice,
    supportedCurrencies,
} from "@/lib/hosted/billing/pricing";

describe("resolveCurrency", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd_found";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur_found";
        envMock.STRIPE_STANDARD_PRICE_ID_USD = "price_usd_standard";
        envMock.STRIPE_STANDARD_PRICE_ID_EUR = "price_eur_standard";
        envMock.STRIPE_PRICE_ID_USD_ANNUAL = "price_usd_year";
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = "price_eur_year";
        envMock.BILLING_DEFAULT_CURRENCY = "usd";
    });

    it("maps EU countries to EUR", () => {
        expect(resolveCurrency("DE")).toBe("eur");
        expect(resolveCurrency("pl")).toBe("eur");
        expect(resolveCurrency("FR")).toBe("eur");
    });

    it("maps non-EU countries to the default currency", () => {
        expect(resolveCurrency("US")).toBe("usd");
        expect(resolveCurrency("GB")).toBe("usd");
        expect(resolveCurrency(null)).toBe("usd");
    });

    it("honors a EUR default for unknown geo", () => {
        envMock.BILLING_DEFAULT_CURRENCY = "eur";
        expect(resolveCurrency(null)).toBe("eur");
        expect(resolveCurrency("US")).toBe("eur");
    });

    it("falls back to the configured currency for the same interval and monthly kind", () => {
        envMock.STRIPE_PRICE_ID_EUR = undefined;
        expect(resolveCurrency("DE", "month", "founding")).toBe("usd");
        envMock.STRIPE_STANDARD_PRICE_ID_USD = undefined;
        expect(resolveCurrency("US", "month", "standard")).toBe("eur");
    });

    it("does not fall back from annual to monthly", () => {
        envMock.STRIPE_PRICE_ID_USD_ANNUAL = undefined;
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = undefined;
        expect(resolveCurrency("US", "year")).toBe("usd");
        expect(() => resolvePrice("US", "year")).toThrow("interval year");
    });
});

describe("priceForCurrency / resolvePrice", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd_found";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur_found";
        envMock.STRIPE_STANDARD_PRICE_ID_USD = "price_usd_standard";
        envMock.STRIPE_STANDARD_PRICE_ID_EUR = "price_eur_standard";
        envMock.STRIPE_PRICE_ID_USD_ANNUAL = "price_usd_year";
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = "price_eur_year";
        envMock.BILLING_PRICE_USD_ANNUAL = "50.00";
        envMock.BILLING_PRICE_EUR_ANNUAL = "50.00";
        envMock.BILLING_DEFAULT_CURRENCY = "usd";
    });

    it("returns the configured founding monthly price for a currency", () => {
        expect(priceForCurrency("eur")).toEqual({
            currency: "eur",
            interval: "month",
            monthlyKind: "founding",
            priceId: "price_eur_found",
            displayAmount: "5.00",
        });
    });

    it("returns the configured standard monthly price for a currency", () => {
        expect(priceForCurrency("usd", "month", "standard")).toEqual({
            currency: "usd",
            interval: "month",
            monthlyKind: "standard",
            priceId: "price_usd_standard",
            displayAmount: "9.00",
        });
    });

    it("returns the configured annual price for a currency", () => {
        expect(priceForCurrency("usd", "year")).toEqual({
            currency: "usd",
            interval: "year",
            monthlyKind: null,
            priceId: "price_usd_year",
            displayAmount: "50.00",
        });
    });

    it("returns null when a currency+interval has no configured Price", () => {
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = undefined;
        expect(priceForCurrency("eur", "year")).toBeNull();
    });

    it("resolvePrice picks founding or standard monthly based on caller input", () => {
        expect(resolvePrice("DE", "month", "founding").priceId).toBe(
            "price_eur_found",
        );
        expect(resolvePrice("DE", "month", "standard").priceId).toBe(
            "price_eur_standard",
        );
    });

    it("resolvePrice throws when nothing is configured for that interval", () => {
        envMock.STRIPE_PRICE_ID_USD_ANNUAL = undefined;
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = undefined;
        expect(() => resolvePrice("US", "year")).toThrow();
    });

    it("exposes structured public pricing and real founding availability without price ids", () => {
        const catalog = billingPriceCatalog({
            capacity: 100,
            claimed: 12,
            reserved: 0,
            remaining: 88,
        });
        expect(catalog).toMatchObject({
            monthly: {
                founding: {
                    usd: {
                        currency: "usd",
                        interval: "month",
                        displayAmount: "5.00",
                        available: true,
                    },
                },
                standard: {
                    eur: {
                        currency: "eur",
                        interval: "month",
                        displayAmount: "9.00",
                        available: true,
                    },
                },
                foundingAvailability: {
                    capacity: 100,
                    claimed: 12,
                    reserved: 0,
                    remaining: 88,
                },
            },
        });
        expect(catalog.monthly.founding.usd).not.toHaveProperty("priceId");
        expect(catalog.monthly.standard.eur).not.toHaveProperty("priceId");
        expect(catalog.annual.usd).not.toHaveProperty("priceId");
    });
});

describe("supportedCurrencies / isProPriceId", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd_found";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur_found";
        envMock.STRIPE_STANDARD_PRICE_ID_USD = "price_usd_standard";
        envMock.STRIPE_STANDARD_PRICE_ID_EUR = "price_eur_standard";
        envMock.STRIPE_PRICE_ID_USD_ANNUAL = "price_usd_year";
        envMock.STRIPE_PRICE_ID_EUR_ANNUAL = "price_eur_year";
        envMock.STRIPE_LEGACY_PRO_PRICE_IDS = ["price_legacy"];
    });

    it("lists only configured currencies for an interval and monthly kind", () => {
        expect(supportedCurrencies()).toEqual(["usd", "eur"]);
        envMock.STRIPE_PRICE_ID_USD = undefined;
        expect(supportedCurrencies()).toEqual(["eur"]);
        envMock.STRIPE_STANDARD_PRICE_ID_EUR = undefined;
        expect(supportedCurrencies("month", "standard")).toEqual(["usd"]);
    });

    it("recognizes current and legacy Pro price ids", () => {
        expect(isProPriceId("price_usd_found")).toBe(true);
        expect(isProPriceId("price_eur_found")).toBe(true);
        expect(isProPriceId("price_usd_standard")).toBe(true);
        expect(isProPriceId("price_eur_standard")).toBe(true);
        expect(isProPriceId("price_usd_year")).toBe(true);
        expect(isProPriceId("price_eur_year")).toBe(true);
        expect(isProPriceId("price_legacy")).toBe(true);
        expect(isProPriceId("price_other")).toBe(false);
        expect(isProPriceId(null)).toBe(false);
    });

    it("detects founding monthly prices separately from standard monthly prices", () => {
        expect(isFoundingMonthlyPriceId("price_usd_found")).toBe(true);
        expect(isFoundingMonthlyPriceId("price_usd_standard")).toBe(false);
        expect(isFoundingMonthlyPriceId("price_usd_year")).toBe(false);
    });

    it("returns the configured current and legacy Pro price ids", () => {
        expect(configuredProPriceIds()).toEqual([
            "price_usd_found",
            "price_eur_found",
            "price_usd_standard",
            "price_eur_standard",
            "price_usd_year",
            "price_eur_year",
            "price_legacy",
        ]);
    });
});
