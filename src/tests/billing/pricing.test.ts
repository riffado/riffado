import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        STRIPE_PRICE_ID_USD: "price_usd" as string | undefined,
        STRIPE_PRICE_ID_EUR: "price_eur" as string | undefined,
        BILLING_PRICE_USD: "5.00",
        BILLING_PRICE_EUR: "5.00",
        BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
    },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    isProPriceId,
    priceForCurrency,
    resolveCurrency,
    resolvePrice,
    supportedCurrencies,
} from "@/lib/hosted/billing/pricing";

describe("resolveCurrency", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur";
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

    it("falls back to the configured currency when the preferred one has no Price", () => {
        envMock.STRIPE_PRICE_ID_EUR = undefined;
        // EU buyer prefers EUR, but only USD is configured -> USD.
        expect(resolveCurrency("DE")).toBe("usd");
    });
});

describe("priceForCurrency / resolvePrice", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur";
        envMock.BILLING_DEFAULT_CURRENCY = "usd";
    });

    it("returns the configured price for a currency", () => {
        expect(priceForCurrency("eur")).toEqual({
            currency: "eur",
            priceId: "price_eur",
            displayAmount: "5.00",
        });
    });

    it("returns null when a currency has no configured Price", () => {
        envMock.STRIPE_PRICE_ID_EUR = undefined;
        expect(priceForCurrency("eur")).toBeNull();
    });

    it("resolvePrice picks the geo currency's price", () => {
        expect(resolvePrice("DE").priceId).toBe("price_eur");
        expect(resolvePrice("US").priceId).toBe("price_usd");
    });

    it("resolvePrice throws when nothing is configured", () => {
        envMock.STRIPE_PRICE_ID_USD = undefined;
        envMock.STRIPE_PRICE_ID_EUR = undefined;
        expect(() => resolvePrice("US")).toThrow();
    });
});

describe("supportedCurrencies / isProPriceId", () => {
    beforeEach(() => {
        envMock.STRIPE_PRICE_ID_USD = "price_usd";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur";
    });

    it("lists only configured currencies", () => {
        expect(supportedCurrencies()).toEqual(["usd", "eur"]);
        envMock.STRIPE_PRICE_ID_USD = undefined;
        expect(supportedCurrencies()).toEqual(["eur"]);
    });

    it("recognizes configured Pro price ids only", () => {
        expect(isProPriceId("price_usd")).toBe(true);
        expect(isProPriceId("price_eur")).toBe(true);
        expect(isProPriceId("price_other")).toBe(false);
        expect(isProPriceId(null)).toBe(false);
    });
});
