import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
    DEFAULT_LOCALE,
    isSupportedLocale,
    LOCALE_COOKIE,
    SUPPORTED_LOCALES,
} from "./locales";

/**
 * Resolution order for the UI locale:
 *   1. The `openplaud-locale` cookie (set by the in-app switcher).
 *   2. The `Accept-Language` header's first supported entry.
 *   3. DEFAULT_LOCALE.
 *
 * We deliberately avoid the URL-prefixed strategy (`/en/dashboard` /
 * `/de/dashboard`) because OpenPlaud is a single-tenant self-host SPA;
 * forcing every existing route through `[locale]` would invalidate
 * external bookmarks, all webhook URLs in operator config, and the
 * docs site. Cookie-only keeps every URL stable.
 */
export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isSupportedLocale(fromCookie)) {
        return {
            locale: fromCookie,
            messages: (await import(`../../messages/${fromCookie}.json`))
                .default,
        };
    }

    const acceptLanguage = (await headers()).get("accept-language") ?? "";
    const fromHeader = pickFromAcceptLanguage(acceptLanguage);
    const locale = fromHeader ?? DEFAULT_LOCALE;

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});

function pickFromAcceptLanguage(header: string): string | null {
    if (!header) return null;
    // Parse the `q`-weighted list per RFC 7231. We only need the
    // primary subtag (`de-DE` → `de`); browsers send the parent tag
    // alongside the regional one already in most cases.
    const tags = header
        .split(",")
        .map((part) => {
            const [tag, ...rest] = part.trim().split(";");
            const q = rest.map((r) => r.trim()).find((r) => r.startsWith("q="));
            const weight = q ? Number.parseFloat(q.slice(2)) : 1;
            return { tag: tag.toLowerCase(), weight };
        })
        .filter((t) => t.tag && Number.isFinite(t.weight) && t.weight > 0)
        .sort((a, b) => b.weight - a.weight);

    for (const { tag } of tags) {
        const primary = tag.split("-")[0];
        if (SUPPORTED_LOCALES.some((l) => l.code === primary)) {
            return primary;
        }
    }
    return null;
}
