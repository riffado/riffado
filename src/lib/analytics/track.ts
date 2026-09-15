/**
 * Open Analytics `window.oa.track(name, props?)` shape. The script is
 * loaded via `<Script strategy="afterInteractive">` (see
 * `OpenAnalytics`), so the global may not exist yet at first render --
 * always guard. On namespace conflict the snippet installs as
 * `window.openanalytics` instead.
 */
declare global {
    interface Window {
        oa?: {
            track?: (name: string, props?: Record<string, unknown>) => void;
        };
        openanalytics?: {
            track?: (name: string, props?: Record<string, unknown>) => void;
        };
    }
}

export function track(name: string, props?: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    try {
        const oa = window.oa ?? window.openanalytics;
        oa?.track?.(name, props);
    } catch {
        // Analytics must never break the page.
    }
}
