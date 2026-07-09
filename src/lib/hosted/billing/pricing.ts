import { env } from "@/lib/env";

export type BillingCurrency = "usd" | "eur";

export interface CurrencyPrice {
    currency: BillingCurrency;
    /** Stripe Price id (price_...). */
    priceId: string;
    /** Display amount as a decimal string, e.g. "5.00". */
    displayAmount: string;
}

/**
 * EU/EEA countries billed in EUR. Everything else falls back to the
 * default currency (USD). This is presentment currency only -- VAT
 * treatment is handled separately from our own records.
 */
const EUR_COUNTRIES = new Set<string>([
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "GR",
    "HU",
    "IE",
    "IT",
    "LV",
    "LT",
    "LU",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",
    "IS",
    "LI",
    "NO",
]);

/** The default currency when geo is unknown (worker emails, no-geo checkout). */
export function defaultCurrency(): BillingCurrency {
    return env.BILLING_DEFAULT_CURRENCY;
}

/** Currencies that have a configured Stripe Price on this instance. */
export function supportedCurrencies(): BillingCurrency[] {
    const out: BillingCurrency[] = [];
    if (env.STRIPE_PRICE_ID_USD) out.push("usd");
    if (env.STRIPE_PRICE_ID_EUR) out.push("eur");
    return out;
}

/**
 * Price config for a currency, or `null` if that currency has no Stripe
 * Price configured on this instance.
 */
export function priceForCurrency(
    currency: BillingCurrency,
): CurrencyPrice | null {
    if (currency === "usd") {
        return env.STRIPE_PRICE_ID_USD
            ? {
                  currency: "usd",
                  priceId: env.STRIPE_PRICE_ID_USD,
                  displayAmount: env.BILLING_PRICE_USD,
              }
            : null;
    }
    return env.STRIPE_PRICE_ID_EUR
        ? {
              currency: "eur",
              priceId: env.STRIPE_PRICE_ID_EUR,
              displayAmount: env.BILLING_PRICE_EUR,
          }
        : null;
}

/**
 * Resolve which currency to charge for a checkout, given the buyer's
 * country (ISO-3166-1 alpha-2). EU/EEA -> EUR, else -> default. Falls
 * back to whichever currency is actually configured if the preferred
 * one has no Stripe Price.
 */
export function resolveCurrency(country?: string | null): BillingCurrency {
    const preferred: BillingCurrency =
        country && EUR_COUNTRIES.has(country.toUpperCase())
            ? "eur"
            : defaultCurrency();

    if (priceForCurrency(preferred)) return preferred;

    const fallback = supportedCurrencies()[0];
    return fallback ?? preferred;
}

/** Resolve the price config for a checkout, throwing if nothing is configured. */
export function resolvePrice(country?: string | null): CurrencyPrice {
    const currency = resolveCurrency(country);
    const price = priceForCurrency(currency);
    if (!price) {
        throw new Error(
            "billing: no Stripe Price configured (set STRIPE_PRICE_ID_USD and/or STRIPE_PRICE_ID_EUR)",
        );
    }
    return price;
}

/** Is this Stripe Price id one of our configured Pro prices? */
export function isProPriceId(priceId: string | null | undefined): boolean {
    if (!priceId) return false;
    return (
        priceId === env.STRIPE_PRICE_ID_USD ||
        priceId === env.STRIPE_PRICE_ID_EUR
    );
}

/** Display amount for a currency (for marketing/email copy). */
export function displayAmountForCurrency(currency: BillingCurrency): string {
    return currency === "usd" ? env.BILLING_PRICE_USD : env.BILLING_PRICE_EUR;
}
