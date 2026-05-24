/**
 * Supported UI locales. Source of truth — keep `messages/<code>.json`
 * in lockstep. The first entry is the fallback when the cookie/header
 * resolution yields nothing usable.
 *
 * Adding a new locale = (1) add the entry here, (2) add the JSON file
 * under `messages/<code>.json`, (3) translate the strings. No other
 * wiring needed; `request.ts` and the `LocaleSwitcher` pick the new
 * entry up automatically.
 */
export const SUPPORTED_LOCALES = [
    { code: "en", label: "English" },
    { code: "de", label: "Deutsch" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_COOKIE = "openplaud-locale";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
    return (
        typeof value === "string" &&
        SUPPORTED_LOCALES.some((l) => l.code === value)
    );
}
