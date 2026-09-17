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

function tracker() {
    if (typeof window.oa?.track === "function") return window.oa;
    if (typeof window.openanalytics?.track === "function") {
        return window.openanalytics;
    }
    return undefined;
}

export function track(name: string, props?: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    try {
        tracker()?.track?.(name, props);
    } catch {
        // Analytics must never break the page.
    }
}
