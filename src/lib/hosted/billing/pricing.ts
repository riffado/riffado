import { env } from "@/lib/env";

export type BillingCurrency = "usd" | "eur";
export type BillingInterval = "month" | "year";
export type MonthlyPriceKind = "founding" | "standard";

export interface CurrencyPrice {
    currency: BillingCurrency;
    interval: BillingInterval;
    monthlyKind: MonthlyPriceKind | null;
    /** Stripe Price id (price_...). */
    priceId: string;
    /** Display amount as a decimal string, e.g. "5.00". */
    displayAmount: string | null;
}

export interface PublicPrice {
    currency: BillingCurrency;
    interval: BillingInterval;
    displayAmount: string | null;
    available: boolean;
}

export interface PublicMonthlyPrices {
    founding: Record<BillingCurrency, PublicPrice | null>;
    standard: Record<BillingCurrency, PublicPrice | null>;
    /** Real DB-backed availability when the caller supplies it. */
    foundingAvailability?: FoundingMemberAvailability;
}

export interface FoundingMemberAvailability {
    capacity: number;
    claimed: number;
    reserved: number;
    remaining: number;
}

export interface BillingPriceCatalog {
    monthly: PublicMonthlyPrices;
    annual: Record<BillingCurrency, PublicPrice | null>;
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

/** Currencies that have a configured Stripe Price for the requested interval. */
export function supportedCurrencies(
    interval: BillingInterval = "month",
    monthlyKind: MonthlyPriceKind = "founding",
): BillingCurrency[] {
    const out: BillingCurrency[] = [];
    if (priceForCurrency("usd", interval, monthlyKind)) out.push("usd");
    if (priceForCurrency("eur", interval, monthlyKind)) out.push("eur");
    return out;
}

/**
 * Price config for a currency + interval, or `null` if that exact catalog
 * entry has no Stripe Price configured on this instance.
 */
export function priceForCurrency(
    currency: BillingCurrency,
    interval: BillingInterval = "month",
    monthlyKind: MonthlyPriceKind = "founding",
): CurrencyPrice | null {
    const priceId = stripePriceIdFor(currency, interval, monthlyKind);
    if (!priceId) return null;
    return {
        currency,
        interval,
        monthlyKind: interval === "month" ? monthlyKind : null,
        priceId,
        displayAmount: displayAmountForCurrencyInterval(
            currency,
            interval,
            monthlyKind,
        ),
    };
}

/** Public billing catalog without exposing Stripe Price ids to clients. */
export function billingPriceCatalog(
    foundingAvailability?: FoundingMemberAvailability,
): BillingPriceCatalog {
    return {
        monthly: {
            founding: {
                usd: publicPriceForCurrency("usd", "month", "founding"),
                eur: publicPriceForCurrency("eur", "month", "founding"),
            },
            standard: {
                usd: publicPriceForCurrency("usd", "month", "standard"),
                eur: publicPriceForCurrency("eur", "month", "standard"),
            },
            ...(foundingAvailability ? { foundingAvailability } : {}),
        },
        annual: {
            usd: publicPriceForCurrency("usd", "year", "standard"),
            eur: publicPriceForCurrency("eur", "year", "standard"),
        },
    };
}

/**
 * Resolve which currency to charge for a checkout, given the buyer's
 * country (ISO-3166-1 alpha-2). EU/EEA -> EUR, else -> default. Falls
 * back to whichever currency is actually configured for the same interval
 * and monthly price kind if the preferred one has no Stripe Price.
 */
export function resolveCurrency(
    country?: string | null,
    interval: BillingInterval = "month",
    monthlyKind: MonthlyPriceKind = "founding",
): BillingCurrency {
    const preferred: BillingCurrency =
        country && EUR_COUNTRIES.has(country.toUpperCase())
            ? "eur"
            : defaultCurrency();

    if (priceForCurrency(preferred, interval, monthlyKind)) return preferred;

    const fallback = supportedCurrencies(interval, monthlyKind)[0];
    return fallback ?? preferred;
}

/**
 * Resolve the buyer's country from the configured trusted geo header, if
 * any (`GEO_COUNTRY_HEADER`; unset on instances that haven't wired up an
 * edge-injected country header, in which case currency always falls back
 * to `BILLING_DEFAULT_CURRENCY`). Used identically by the checkout route
 * and every price-DISPLAY surface so what's shown always matches what
 * Stripe will actually charge.
 */
export function resolveRequestCountry(
    getHeader: (name: string) => string | null,
): string | null {
    return env.GEO_COUNTRY_HEADER ? getHeader(env.GEO_COUNTRY_HEADER) : null;
}

/**
 * Pick the single price to *display* for a visitor out of a catalog side
 * that may carry an entry per configured currency. Falls back to whichever
 * currency IS configured for this tier if the preferred one isn't. Never
 * join multiple currencies together in copy -- Stripe only ever charges
 * the buyer one of them, so showing more than one is not a real choice,
 * just noise.
 */
export function pickDisplayPrice(
    side: Record<BillingCurrency, PublicPrice | null>,
    preferred: BillingCurrency,
): PublicPrice | null {
    return side[preferred] ?? side[preferred === "usd" ? "eur" : "usd"] ?? null;
}

/** Resolve the price config for a checkout, throwing if that interval has no configured Price. */
export function resolvePrice(
    country?: string | null,
    interval: BillingInterval = "month",
    monthlyKind: MonthlyPriceKind = "founding",
): CurrencyPrice {
    const currency = resolveCurrency(country, interval, monthlyKind);
    const price = priceForCurrency(currency, interval, monthlyKind);
    if (!price) {
        throw new Error(
            `billing: no Stripe Price configured for interval ${interval}`,
        );
    }
    return price;
}

export function resolveStandardMonthlyPriceForCurrency(
    currency: BillingCurrency,
): CurrencyPrice {
    const price = priceForCurrency(currency, "month", "standard");
    if (!price) {
        throw new Error(
            `billing: no standard monthly Stripe Price configured for ${currency}`,
        );
    }
    return price;
}

/** Current + legacy Stripe Price ids that grant Hosted Pro entitlements. */
export function configuredProPriceIds(): string[] {
    return [
        env.STRIPE_PRICE_ID_USD,
        env.STRIPE_PRICE_ID_EUR,
        env.STRIPE_STANDARD_PRICE_ID_USD,
        env.STRIPE_STANDARD_PRICE_ID_EUR,
        env.STRIPE_PRICE_ID_USD_ANNUAL,
        env.STRIPE_PRICE_ID_EUR_ANNUAL,
        ...env.STRIPE_LEGACY_PRO_PRICE_IDS,
    ].flatMap((priceId) => (priceId ? [priceId] : []));
}

/** Is this Stripe Price id one of our configured current or legacy Pro prices? */
export function isProPriceId(priceId: string | null | undefined): boolean {
    if (!priceId) return false;
    return configuredProPriceIds().includes(priceId);
}

export function isFoundingMonthlyPriceId(
    priceId: string | null | undefined,
): boolean {
    if (!priceId) return false;
    return (
        priceId === env.STRIPE_PRICE_ID_USD ||
        priceId === env.STRIPE_PRICE_ID_EUR
    );
}

/** Display amount for a founding monthly currency (for marketing/email copy). */
export function displayAmountForCurrency(currency: BillingCurrency): string {
    return currency === "usd" ? env.BILLING_PRICE_USD : env.BILLING_PRICE_EUR;
}

export function displayStandardAmountForCurrency(
    currency: BillingCurrency,
): string {
    return currency === "usd"
        ? env.BILLING_STANDARD_PRICE_USD
        : env.BILLING_STANDARD_PRICE_EUR;
}

/** Trim a decimal display amount for marketing copy ("5.00" -> "5", "7.50" unchanged). */
export function trimDisplayAmount(amount: string): string {
    return amount.replace(/\.00$/, "");
}

function stripePriceIdFor(
    currency: BillingCurrency,
    interval: BillingInterval,
    monthlyKind: MonthlyPriceKind,
): string | undefined {
    switch (interval) {
        case "month":
            switch (currency) {
                case "usd":
                    return monthlyKind === "founding"
                        ? env.STRIPE_PRICE_ID_USD
                        : env.STRIPE_STANDARD_PRICE_ID_USD;
                case "eur":
                    return monthlyKind === "founding"
                        ? env.STRIPE_PRICE_ID_EUR
                        : env.STRIPE_STANDARD_PRICE_ID_EUR;
                default:
                    return assertNever(currency);
            }
        case "year":
            switch (currency) {
                case "usd":
                    return env.STRIPE_PRICE_ID_USD_ANNUAL;
                case "eur":
                    return env.STRIPE_PRICE_ID_EUR_ANNUAL;
                default:
                    return assertNever(currency);
            }
        default:
            return assertNever(interval);
    }
}

function displayAmountForCurrencyInterval(
    currency: BillingCurrency,
    interval: BillingInterval,
    monthlyKind: MonthlyPriceKind,
): string | null {
    switch (interval) {
        case "month":
            return monthlyKind === "founding"
                ? displayAmountForCurrency(currency)
                : displayStandardAmountForCurrency(currency);
        case "year":
            switch (currency) {
                case "usd":
                    return env.BILLING_PRICE_USD_ANNUAL ?? null;
                case "eur":
                    return env.BILLING_PRICE_EUR_ANNUAL ?? null;
                default:
                    return assertNever(currency);
            }
        default:
            return assertNever(interval);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled billing price dimension: ${String(value)}`);
}

function publicPriceForCurrency(
    currency: BillingCurrency,
    interval: BillingInterval,
    monthlyKind: MonthlyPriceKind,
): PublicPrice | null {
    const price = priceForCurrency(currency, interval, monthlyKind);
    if (!price) return null;
    return {
        currency: price.currency,
        interval: price.interval,
        displayAmount: price.displayAmount,
        available: true,
    };
}
