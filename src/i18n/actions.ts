"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isSupportedLocale, LOCALE_COOKIE } from "./locales";

/**
 * Persists the chosen UI locale in a long-lived cookie and revalidates
 * the whole tree so the next render uses the new messages bundle.
 *
 * Server Action shape (no Response) so it can be passed straight as
 * `formAction` to a `<form>` or invoked imperatively from a client
 * component via `useTransition`. Validates against the supported list
 * — an attacker (or a malformed client) can't poison the cookie with
 * a value that would crash `request.ts`'s dynamic import.
 */
export async function setLocale(locale: string): Promise<void> {
    if (!isSupportedLocale(locale)) {
        throw new Error(`Unsupported locale: ${locale}`);
    }
    const store = await cookies();
    store.set(LOCALE_COOKIE, locale, {
        // 1 year — UI language is a strong preference, not session state.
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
        // No `secure: true` flag — works over the localhost dev server
        // too. The cookie carries a locale string, not a credential.
        httpOnly: false,
    });
    revalidatePath("/", "layout");
}
