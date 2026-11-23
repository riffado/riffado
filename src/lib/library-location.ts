const STORAGE_KEY = "riffado:library-location";

/**
 * Remembers the library address this tab is showing (path plus `?r=` for
 * the open recording), so Settings can return to the same recording.
 */
export function rememberLibraryLocation(): void {
    try {
        sessionStorage.setItem(
            STORAGE_KEY,
            `${window.location.pathname}${window.location.search}`,
        );
    } catch {
        // Storage can be unavailable (private mode quotas); `/dashboard` still works.
    }
}

/** Where Settings returns to: the library address this tab last showed, else `/dashboard`. */
export function libraryLocation(): string {
    try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored?.startsWith("/") && !stored.startsWith("//")) return stored;
    } catch {
        // Fall through to the default.
    }
    return "/dashboard";
}
