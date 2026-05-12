"use client";

import { useTheme as useNextTheme } from "next-themes";
import { useCallback } from "react";

export type Theme = "light" | "dark" | "system";

/**
 * Theme manager. Delegates DOM class application and localStorage
 * persistence to `next-themes` (already wired up in the root layout
 * via `<ThemeProvider>`), and layers on lazy server-side persistence
 * to `userSettings.theme` so the choice survives across devices.
 *
 * Why a wrapper instead of calling `next-themes` directly:
 *   - Callers get a stable, typed API (`Theme` union, non-optional
 *     `theme`/`setTheme`) regardless of next-themes internals.
 *   - One place owns the "also POST to /api/settings/user" side effect.
 *
 * The `initial` argument is intentionally unused at runtime \u2014
 * `next-themes` already restores the active theme from localStorage
 * before hydration via its inline script. We accept it only so
 * existing call sites don't need to be refactored.
 */
export function useTheme(_initial: Theme) {
    const { theme: rawTheme, setTheme: setNextTheme } = useNextTheme();

    // `next-themes` typings allow `theme` to be `undefined` during the
    // first render \u2014 normalize to "system" so callers can treat it as
    // a concrete value.
    const theme = (rawTheme as Theme | undefined) ?? "system";

    const setTheme = useCallback(
        (next: Theme) => {
            setNextTheme(next);
            // Best-effort server persistence; failures are silent \u2014 the
            // UI already reflects the change locally.
            fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme: next }),
            }).catch(() => {});
        },
        [setNextTheme],
    );

    return { theme, setTheme } as const;
}
