const CURRENCY_SYMBOLS: Record<string, string> = {
    usd: "$",
    eur: "\u20ac",
};

/**
 * Trim a decimal display amount ("5.00" -> "5", "7.50" unchanged).
 * Mirrors `trimDisplayAmount` in `@/lib/hosted/billing/pricing` --
 * duplicated locally so email templates stay free of that module's
 * `@/lib/env` import, which requires a full hosted-runtime env (e.g.
 * `DATABASE_URL`) to load.
 */
function trimAmount(amount: string): string {
    return amount.replace(/\.00$/, "");
}

/**
 * Format a decimal amount + ISO currency code for email copy, matching
 * the site's price display ("$5/month" instead of "5.00 USD/month").
 */
export function formatEmailPrice(
    amountValue: string,
    amountCurrency: string,
    suffix = "/month",
): string {
    const symbol = CURRENCY_SYMBOLS[amountCurrency.toLowerCase()] ?? "";
    return `${symbol}${trimAmount(amountValue)}${suffix}`;
}
