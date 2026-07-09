"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-errors";

interface UseAutoSyncOptions {
    interval?: number;
    minInterval?: number;
    syncOnMount?: boolean;
    syncOnVisibilityChange?: boolean;
    enabled?: boolean;
    onSuccess?: (newRecordings: number) => void;
    onError?: (error: string) => void;
}

interface SyncStatus {
    isAutoSyncing: boolean;
    lastSyncTime: Date | null;
    nextSyncTime: Date | null;
    lastSyncResult: {
        success: boolean;
        newRecordings?: number;
        error?: string;
        /** True when Plaud rejected the stored token during this sync. */
        needsReconnect?: boolean;
    } | null;
}

const STORAGE_KEY = "riffado_last_sync";
// Cross-tab in-flight stamp. Format: `${startedAtMs}:${token}`. Clear
// side checks token match to avoid a TOCTOU wipe between concurrent tabs.
const IN_FLIGHT_KEY = "riffado_sync_in_progress";
const IN_FLIGHT_TTL_MS = 90_000;
const MANUAL_MIN_INTERVAL_MS = 5_000;

function parseStamp(
    raw: string | null,
): { startedAt: number; token: string } | null {
    if (!raw) return null;
    const sep = raw.indexOf(":");
    // Back-compat with bare-timestamp values: empty token never matches
    // on clear, so TTL expires them instead.
    const startedAtStr = sep === -1 ? raw : raw.slice(0, sep);
    const token = sep === -1 ? "" : raw.slice(sep + 1);
    const startedAt = Number.parseInt(startedAtStr, 10);
    if (!Number.isFinite(startedAt)) return null;
    return { startedAt, token };
}

function readInFlightStamp(): number | null {
    try {
        const parsed = parseStamp(localStorage.getItem(IN_FLIGHT_KEY));
        if (!parsed) return null;
        if (Date.now() - parsed.startedAt > IN_FLIGHT_TTL_MS) return null;
        return parsed.startedAt;
    } catch {
        return null;
    }
}

function writeInFlightStamp(token: string): void {
    try {
        localStorage.setItem(IN_FLIGHT_KEY, `${Date.now()}:${token}`);
    } catch {}
}

// Only clear if token matches; prevents one tab wiping another tab's lock.
function clearInFlightStampIfOwned(token: string): void {
    try {
        const parsed = parseStamp(localStorage.getItem(IN_FLIGHT_KEY));
        if (parsed && parsed.token === token) {
            localStorage.removeItem(IN_FLIGHT_KEY);
        }
    } catch {}
}

function newSyncToken(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useAutoSync(options: UseAutoSyncOptions = {}) {
    const {
        interval = 5 * 60 * 1000,
        minInterval = 60 * 1000,
        syncOnMount = true,
        syncOnVisibilityChange = true,
        enabled = true,
        onSuccess,
        onError,
    } = options;

    const router = useRouter();
    const [status, setStatus] = useState<SyncStatus>({
        isAutoSyncing: false,
        lastSyncTime: null,
        nextSyncTime: null,
        lastSyncResult: null,
    });

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isSyncingRef = useRef(false);
    const lastSyncTimeRef = useRef<number>(0);
    const onSuccessRef = useRef(onSuccess);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onSuccessRef.current = onSuccess;
        onErrorRef.current = onError;
    }, [onSuccess, onError]);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const lastSync = new Date(stored);
            setStatus((prev) => ({ ...prev, lastSyncTime: lastSync }));
            lastSyncTimeRef.current = lastSync.getTime();
        }
    }, []);

    const performSync = useCallback(
        async (silent = true) => {
            if (isSyncingRef.current) {
                return;
            }

            const now = Date.now();

            if (silent) {
                const timeSinceLastSync = now - lastSyncTimeRef.current;
                if (timeSinceLastSync < minInterval) {
                    return;
                }
            } else {
                const timeSinceLastSync = now - lastSyncTimeRef.current;
                if (timeSinceLastSync < MANUAL_MIN_INTERVAL_MS) {
                    const waitSeconds = Math.ceil(
                        (MANUAL_MIN_INTERVAL_MS - timeSinceLastSync) / 1000,
                    );
                    onErrorRef.current?.(
                        `Just synced. Try again in ${waitSeconds}s.`,
                    );
                    return;
                }
            }

            if (readInFlightStamp() !== null) {
                return;
            }

            const token = newSyncToken();
            isSyncingRef.current = true;
            writeInFlightStamp(token);
            setStatus((prev) => ({ ...prev, isAutoSyncing: true }));

            try {
                const response = await fetch("/api/plaud/sync", {
                    method: "POST",
                });

                if (response.ok) {
                    const result = await response.json();
                    const syncTime = new Date();
                    lastSyncTimeRef.current = syncTime.getTime();
                    localStorage.setItem(STORAGE_KEY, syncTime.toISOString());

                    if (result.inProgress) {
                        setStatus((prev) => ({
                            ...prev,
                            lastSyncTime: syncTime,
                            lastSyncResult: {
                                success: true,
                                newRecordings: 0,
                            },
                        }));
                        return;
                    }

                    setStatus((prev) => ({
                        ...prev,
                        lastSyncTime: syncTime,
                        lastSyncResult: {
                            success: true,
                            newRecordings: result.newRecordings || 0,
                            needsReconnect: result.needsReconnect === true,
                        },
                    }));

                    if (!silent || result.newRecordings > 0) {
                        router.refresh();
                    }

                    if (result.newRecordings > 0) {
                        onSuccessRef.current?.(result.newRecordings);
                    } else if (!silent) {
                        onSuccessRef.current?.(0);
                    }
                } else {
                    const errorMessage = await getApiErrorMessage(
                        response,
                        "Sync failed",
                    );

                    setStatus((prev) => ({
                        ...prev,
                        lastSyncResult: {
                            success: false,
                            error: errorMessage,
                        },
                    }));

                    if (!silent) {
                        onErrorRef.current?.(errorMessage);
                    }
                }
            } catch {
                const errorMessage = "Failed to sync with Plaud device";
                setStatus((prev) => ({
                    ...prev,
                    lastSyncResult: {
                        success: false,
                        error: errorMessage,
                    },
                }));

                if (!silent) {
                    onErrorRef.current?.(errorMessage);
                }
            } finally {
                isSyncingRef.current = false;
                clearInFlightStampIfOwned(token);
                setStatus((prev) => ({
                    ...prev,
                    isAutoSyncing: false,
                    nextSyncTime: new Date(Date.now() + interval),
                }));
            }
        },
        [router, minInterval, interval],
    );

    useEffect(() => {
        if (!enabled) {
            return;
        }

        if (syncOnMount) {
            performSync(true);
        }

        intervalRef.current = setInterval(() => {
            performSync(true);
        }, interval);

        setStatus((prev) => ({
            ...prev,
            nextSyncTime: new Date(Date.now() + interval),
        }));

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [enabled, interval, syncOnMount, performSync]);

    useEffect(() => {
        if (!enabled || !syncOnVisibilityChange) {
            return;
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                const timeSinceLastSync = Date.now() - lastSyncTimeRef.current;
                if (timeSinceLastSync > interval / 2) {
                    performSync(true);
                }
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, [enabled, syncOnVisibilityChange, interval, performSync]);

    const manualSync = useCallback(() => {
        return performSync(false);
    }, [performSync]);

    return {
        ...status,
        manualSync,
    };
}
