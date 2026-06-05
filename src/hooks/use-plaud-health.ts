"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type PlaudHealthStatus =
    | "unknown"
    | "healthy"
    | "no_connection"
    | "token_invalid"
    | "resyncing"
    | "network_error";

interface UsePlaudHealthOptions {
    /** How often to probe, in ms. Default: 10 minutes. */
    intervalMs?: number;
    /** Skip probing (e.g. user is not on dashboard). Default: false. */
    disabled?: boolean;
}

const PROBE_INTERVAL = 10 * 60 * 1000; // 10 minutes
const RESYNC_COOLDOWN = 60 * 1000; // don't retry resync more than once/min

/**
 * Background Plaud connection health check.
 *
 * Every `intervalMs` (default 10 min) while the tab is visible:
 *  1. GET /api/plaud/health — tests the stored token against Plaud's API.
 *  2. If unhealthy AND window.__mesynxAiConnector is available:
 *       call connect() → POST /api/plaud/auth/connect-token to silently resync.
 *  3. If unhealthy AND no extension: surface `status` to the caller so the
 *       UI can show a persistent banner asking the user to reconnect.
 *
 * Returns the current health status so callers can render appropriate UI.
 */
export function usePlaudHealth({
    intervalMs = PROBE_INTERVAL,
    disabled = false,
}: UsePlaudHealthOptions = {}) {
    const [status, setStatus] = useState<PlaudHealthStatus>("unknown");
    const lastResync = useRef<number>(0);
    const probeInFlight = useRef(false);

    const probe = useCallback(async () => {
        if (probeInFlight.current) return;
        probeInFlight.current = true;

        try {
            const res = await fetch("/api/plaud/health", {
                // Don't cache health checks
                cache: "no-store",
            });

            if (!res.ok) {
                // Server-side error — don't change status, just skip
                return;
            }

            const data = (await res.json()) as {
                healthy: boolean;
                reason?: string;
            };

            if (data.healthy) {
                setStatus("healthy");
                return;
            }

            const reason = data.reason as PlaudHealthStatus | undefined;

            // No stored connection at all — not our problem to silently fix.
            if (reason === "no_connection") {
                setStatus("no_connection");
                return;
            }

            // Token is invalid or network error — try to resync via extension.
            const connector = (
                window as Window & {
                    __mesynxAiConnector?: {
                        version: number;
                        connect(): Promise<{
                            accessToken: string;
                            apiBase: string;
                            region: string;
                            capturedAt: number;
                        }>;
                    };
                }
            ).__mesynxAiConnector;

            const now = Date.now();
            const canResync =
                connector &&
                typeof connector.version === "number" &&
                connector.version >= 1 &&
                now - lastResync.current > RESYNC_COOLDOWN;

            if (canResync) {
                setStatus("resyncing");
                try {
                    const payload = await connector.connect();
                    const syncRes = await fetch(
                        "/api/plaud/auth/connect-token",
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                accessToken: payload.accessToken,
                                apiBase: payload.apiBase,
                                source: "health-resync",
                            }),
                        },
                    );
                    if (syncRes.ok) {
                        lastResync.current = Date.now();
                        setStatus("healthy");
                        toast.success(
                            "Plaud connection refreshed automatically.",
                            { duration: 3000 },
                        );
                    } else {
                        setStatus(reason ?? "token_invalid");
                    }
                } catch {
                    // Extension connect() failed (user closed popup, timeout, etc.)
                    setStatus(reason ?? "token_invalid");
                }
            } else {
                // No extension available — tell the UI to show a warning.
                setStatus(reason ?? "token_invalid");
            }
        } catch {
            // Network entirely unreachable — don't flip to error state to
            // avoid false positives when the laptop is briefly offline.
        } finally {
            probeInFlight.current = false;
        }
    }, []);

    // Run once on mount (after a short delay to not block initial render),
    // then on the interval, and only when the tab is visible.
    useEffect(() => {
        if (disabled) return;

        // Initial probe — delay 30s so it doesn't compete with page load.
        const boot = setTimeout(probe, 30_000);

        const id = setInterval(() => {
            // Skip if tab is hidden to avoid waking up the Plaud API
            // unnecessarily and to not count hidden time against the interval.
            if (document.visibilityState === "visible") {
                probe();
            }
        }, intervalMs);

        return () => {
            clearTimeout(boot);
            clearInterval(id);
        };
    }, [probe, intervalMs, disabled]);

    // Also re-probe when the tab becomes visible after being hidden.
    useEffect(() => {
        if (disabled) return;
        const handler = () => {
            if (document.visibilityState === "visible") {
                probe();
            }
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    }, [probe, disabled]);

    return { status, probe };
}
