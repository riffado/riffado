"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-errors";

interface UseAutoSyncOptions {
    /**
     * Sync interval in milliseconds
     * @default 300000 (5 minutes)
     */
    interval?: number;
    /**
     * Minimum time between syncs in milliseconds
     * @default 60000 (1 minute)
     */
    minInterval?: number;
    /**
     * Whether to sync on mount
     * @default true
     */
    syncOnMount?: boolean;
    /**
     * Whether to sync when tab becomes visible
     * @default true
     */
    syncOnVisibilityChange?: boolean;
    /**
     * Whether auto-sync is enabled
     * @default true
     */
    enabled?: boolean;
    /**
     * Callback when sync completes successfully
     */
    onSuccess?: (newRecordings: number) => void;
    /**
     * Callback when sync fails
     */
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
    } | null;
}

const STORAGE_KEY = "openplaud_last_sync";

export function useAutoSync(options: UseAutoSyncOptions = {}) {
    const {
        interval = 5 * 60 * 1000, // 5 minutes default
        minInterval = 60 * 1000, // 1 minute minimum
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

    // Update callback refs
    useEffect(() => {
        onSuccessRef.current = onSuccess;
        onErrorRef.current = onError;
    }, [onSuccess, onError]);

    // Load last sync time from localStorage
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

            if (silent) {
                const now = Date.now();
                const timeSinceLastSync = now - lastSyncTimeRef.current;
                if (timeSinceLastSync < minInterval) {
                    return;
                }
            }

            isSyncingRef.current = true;
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

                    setStatus((prev) => ({
                        ...prev,
                        lastSyncTime: syncTime,
                        lastSyncResult: {
                            success: true,
                            newRecordings: result.newRecordings || 0,
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
