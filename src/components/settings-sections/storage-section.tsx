"use client";

import { HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { formatBytes } from "@/lib/format-bytes";

interface StorageSectionProps {
    isHosted?: boolean;
}

export function StorageSection({ isHosted = false }: StorageSectionProps) {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [autoDeleteRecordings, setAutoDeleteRecordings] = useState(false);
    const [retentionDays, setRetentionDays] = useState<number | null>(null);
    const [storageUsage, setStorageUsage] = useState<{
        storageType: string;
        totalSize: number;
        totalRecordings: number;
    } | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    // Tracks a retention-days edit that was scheduled but not yet sent.
    // Used to flush the pending save on unmount so closing the settings
    // dialog inside the debounce window doesn't drop the user's edit.
    const pendingRetentionRef = useRef<number | null | undefined>(undefined);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user", {
                    signal: controller.signal,
                });
                if (cancelled) return;
                if (response.ok) {
                    const data = await response.json();
                    if (cancelled) return;
                    setAutoDeleteRecordings(data.autoDeleteRecordings ?? false);
                    setRetentionDays(data.retentionDays ?? null);
                }
            } catch (error) {
                if (cancelled) return;
                if ((error as { name?: string })?.name === "AbortError") return;
                console.error("Failed to fetch settings:", error);
            } finally {
                if (!cancelled) setIsLoadingSettings(false);
            }
        };
        fetchSettings();

        fetch("/api/settings/storage", { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) return null;
                const data = await res.json();
                if (
                    typeof data?.totalSize === "number" &&
                    typeof data?.totalRecordings === "number" &&
                    typeof data?.storageType === "string"
                ) {
                    return data as {
                        storageType: string;
                        totalSize: number;
                        totalRecordings: number;
                    };
                }
                return null;
            })
            .then((data) => {
                if (cancelled) return;
                setStorageUsage(data);
            })
            .catch((err) => {
                if (cancelled) return;
                if ((err as { name?: string })?.name === "AbortError") return;
                setStorageUsage(null);
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [setIsLoadingSettings]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = undefined;
            }
            const pending = pendingRetentionRef.current;
            if (pending !== undefined) {
                pendingRetentionRef.current = undefined;
                // Fire-and-forget so a pending edit isn't lost when the
                // settings dialog closes inside the debounce window. We can't
                // use handleStorageSettingChange here because it touches
                // unmounted React state on rollback; we accept the trade-off
                // of no error toast in this rare edge case.
                void fetch("/api/settings/user", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ retentionDays: pending }),
                }).catch(() => {});
            }
        };
    }, []);

    const cancelPendingRetentionSave = () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = undefined;
        }
        pendingRetentionRef.current = undefined;
    };

    const flushPendingRetentionSave = () => {
        const pending = pendingRetentionRef.current;
        cancelPendingRetentionSave();
        if (pending === undefined) return;
        handleStorageSettingChange({ retentionDays: pending });
    };

    const handleStorageSettingChange = async (updates: {
        autoDeleteRecordings?: boolean;
        retentionDays?: number | null;
    }) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.autoDeleteRecordings !== undefined) {
            previousValues.autoDeleteRecordings = autoDeleteRecordings;
            setAutoDeleteRecordings(updates.autoDeleteRecordings);
        }
        if (updates.retentionDays !== undefined) {
            previousValues.retentionDays = retentionDays;
            setRetentionDays(updates.retentionDays);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (updates.autoDeleteRecordings !== undefined) {
                const prev = previousValues.autoDeleteRecordings;
                if (typeof prev === "boolean") setAutoDeleteRecordings(prev);
            }
            if (updates.retentionDays !== undefined) {
                const prev = previousValues.retentionDays;
                if (typeof prev === "number" || prev === null)
                    setRetentionDays(prev);
            }
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Storage
            </h2>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-card p-4">
                        <div className="text-xs text-muted-foreground">
                            Total Size
                        </div>
                        <div className="text-2xl font-semibold tabular-nums mt-1">
                            {typeof storageUsage?.totalSize === "number"
                                ? formatBytes(storageUsage.totalSize)
                                : "—"}
                        </div>
                    </div>
                    <div className="rounded-lg border bg-card p-4">
                        <div className="text-xs text-muted-foreground">
                            Recordings
                        </div>
                        <div className="text-2xl font-semibold tabular-nums mt-1">
                            {typeof storageUsage?.totalRecordings === "number"
                                ? storageUsage.totalRecordings
                                : "—"}
                        </div>
                    </div>
                </div>
                {!isHosted && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Type</span>
                        <span className="font-medium">
                            {storageUsage?.storageType || "Local"}
                        </span>
                    </div>
                )}
                <p className="text-xs text-muted-foreground pt-2 border-t">
                    {isHosted
                        ? "Storage for your account on OpenPlaud Hosted. Manage what's kept with auto-delete below."
                        : "Storage is configured at the instance level via environment variables."}
                </p>
            </div>

            <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-delete" className="text-base">
                            Auto-delete old recordings
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically delete recordings older than the
                            retention period
                        </p>
                    </div>
                    <Switch
                        id="auto-delete"
                        checked={autoDeleteRecordings}
                        onCheckedChange={(checked) => {
                            // The toggle settles retentionDays itself, so any
                            // debounced retention edit is now stale and must
                            // not be flushed on unmount.
                            cancelPendingRetentionSave();
                            setAutoDeleteRecordings(checked);
                            if (!checked) {
                                setRetentionDays(null);
                            }
                            handleStorageSettingChange({
                                autoDeleteRecordings: checked,
                                retentionDays: checked ? retentionDays : null,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>

                {autoDeleteRecordings && (
                    <div className="space-y-2">
                        <Label htmlFor="retention-days">
                            Retention period (days)
                        </Label>
                        <Input
                            id="retention-days"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={365}
                            step={1}
                            value={retentionDays || ""}
                            onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") {
                                    setRetentionDays(null);
                                    if (saveTimeoutRef.current) {
                                        clearTimeout(saveTimeoutRef.current);
                                        saveTimeoutRef.current = undefined;
                                    }
                                    pendingRetentionRef.current = undefined;
                                    handleStorageSettingChange({
                                        retentionDays: null,
                                    });
                                    return;
                                }
                                const value = Number(raw);
                                if (
                                    !Number.isInteger(value) ||
                                    value < 1 ||
                                    value > 365
                                ) {
                                    // Reject non-integer or out-of-range
                                    // values silently. Previously parseInt
                                    // would silently floor "1.5" to 1 and
                                    // save it; we now require an integer.
                                    return;
                                }
                                setRetentionDays(value);
                                if (saveTimeoutRef.current) {
                                    clearTimeout(saveTimeoutRef.current);
                                }
                                pendingRetentionRef.current = value;
                                saveTimeoutRef.current = setTimeout(() => {
                                    saveTimeoutRef.current = undefined;
                                    pendingRetentionRef.current = undefined;
                                    handleStorageSettingChange({
                                        retentionDays: value,
                                    });
                                }, 500);
                            }}
                            onBlur={flushPendingRetentionSave}
                            placeholder="30"
                        />
                        <p className="text-xs text-muted-foreground">
                            Recordings older than this will be automatically
                            deleted (1-365 days)
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
