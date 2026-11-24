"use client";

import { useEffect, useRef, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
    ToggleRow,
} from "@/components/settings/toggle-row";
import { BreakdownBar } from "@/components/settings-sections/storage/breakdown-bar";
import { LargestRecordings } from "@/components/settings-sections/storage/largest-recordings";
import { UsageHero } from "@/components/settings-sections/storage/usage-hero";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

interface StorageSectionProps {
    isHosted?: boolean;
}

interface StorageUsage {
    storageType: string;
    usedBytes: number;
    recordingCount: number;
    totalDurationMs: number;
    largest: {
        id: string;
        filename: string;
        filesize: number;
        duration: number;
        startTime: string;
    }[];
    diskFreeBytes: number | null;
    quotaBytes: number | null;
}

export function StorageSection({ isHosted = false }: StorageSectionProps) {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [autoDeleteRecordings, setAutoDeleteRecordings] = useState(false);
    const [retentionDays, setRetentionDays] = useState<number | null>(null);
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    // Distinct from `usage === null` so we can tell "haven't loaded
    // yet" apart from "loaded and the API returned no shape we can
    // use". Without this, the UsageHero rendered all-zero numbers
    // during the fetch — indistinguishable from a real empty account.
    const [isLoadingUsage, setIsLoadingUsage] = useState(true);
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

        setIsLoadingUsage(true);
        fetch("/api/settings/storage", { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) return null;
                const data = (await res.json()) as Partial<StorageUsage>;
                // Defensive shape check — only the fields the UI actually
                // reads. Missing optional fields fall back to safe zeros.
                if (
                    typeof data?.usedBytes === "number" &&
                    typeof data?.recordingCount === "number" &&
                    Array.isArray(data?.largest)
                ) {
                    return {
                        storageType: data.storageType ?? "local",
                        usedBytes: data.usedBytes,
                        recordingCount: data.recordingCount,
                        totalDurationMs: data.totalDurationMs ?? 0,
                        largest: data.largest,
                        diskFreeBytes: data.diskFreeBytes ?? null,
                        quotaBytes: data.quotaBytes ?? null,
                    } satisfies StorageUsage;
                }
                return null;
            })
            .then((data) => {
                if (cancelled) return;
                setUsage(data);
                setIsLoadingUsage(false);
            })
            .catch((err) => {
                if (cancelled) return;
                if ((err as { name?: string })?.name === "AbortError") return;
                setUsage(null);
                setIsLoadingUsage(false);
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

    const isLocal = (usage?.storageType ?? "local") === "local";
    const storageDescription = isHosted
        ? undefined
        : isLocal
          ? "Audio files are stored on this server's disk"
          : "Audio files are stored in S3-compatible object storage";
    const backendFootnote = isHosted
        ? null
        : `${isLocal ? "Local disk" : "S3"}, set in the server's environment variables`;

    return (
        <div className="flex flex-col gap-11">
            <SettingsGroup title="Storage" description={storageDescription}>
                {isLoadingUsage ? (
                    // Match UsageHero's footprint so the layout doesn't
                    // jump when the fetch resolves, without committing to
                    // numbers that would read as a real empty account.
                    <div
                        className="squircle h-32 animate-pulse rounded-[var(--radius-card)] border border-hairline bg-surface"
                        aria-hidden="true"
                    />
                ) : usage ? (
                    <UsageHero
                        usedBytes={usage.usedBytes}
                        recordingCount={usage.recordingCount}
                        totalDurationMs={usage.totalDurationMs}
                        diskFreeBytes={usage.diskFreeBytes}
                        quotaBytes={usage.quotaBytes}
                        footnote={backendFootnote}
                    />
                ) : (
                    <SettingsCard
                        tone="quiet"
                        description="Couldn't load storage usage. Refresh the page to try again"
                    />
                )}

                {!isLoadingUsage && usage && usage.largest.length > 0 && (
                    <div className="flex flex-col gap-6 pt-3">
                        <BreakdownBar
                            segments={usage.largest.map((r) => ({
                                id: r.id,
                                bytes: r.filesize,
                            }))}
                            totalBytes={usage.usedBytes}
                        />
                        <LargestRecordings items={usage.largest} />
                    </div>
                )}
            </SettingsGroup>

            <SettingsGroup title="Clean-up">
                {isLoadingSettings ? (
                    <SettingsRowsSkeleton rows={1} />
                ) : (
                    <SettingsRows>
                        <ToggleRow
                            id="auto-delete"
                            label="Delete old recordings"
                            description="Removes recordings older than the period below"
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
                                    retentionDays: checked
                                        ? retentionDays
                                        : null,
                                });
                            }}
                            disabled={isSavingSettings}
                        />
                        {autoDeleteRecordings && (
                            <SettingsRow
                                label="Keep recordings for"
                                description="Between 1 and 365 days"
                                controlId="retention-days"
                                control={
                                    <>
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
                                                    if (
                                                        saveTimeoutRef.current
                                                    ) {
                                                        clearTimeout(
                                                            saveTimeoutRef.current,
                                                        );
                                                        saveTimeoutRef.current =
                                                            undefined;
                                                    }
                                                    pendingRetentionRef.current =
                                                        undefined;
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
                                                    clearTimeout(
                                                        saveTimeoutRef.current,
                                                    );
                                                }
                                                pendingRetentionRef.current =
                                                    value;
                                                saveTimeoutRef.current =
                                                    setTimeout(() => {
                                                        saveTimeoutRef.current =
                                                            undefined;
                                                        pendingRetentionRef.current =
                                                            undefined;
                                                        handleStorageSettingChange(
                                                            {
                                                                retentionDays:
                                                                    value,
                                                            },
                                                        );
                                                    }, 500);
                                            }}
                                            onBlur={flushPendingRetentionSave}
                                            placeholder="30"
                                            className="squircle h-9.5 w-24 rounded-[var(--radius-control)] border-border text-right tabular-nums"
                                        />
                                        <span className="text-ui text-subtle">
                                            days
                                        </span>
                                    </>
                                }
                            />
                        )}
                    </SettingsRows>
                )}
            </SettingsGroup>
        </div>
    );
}
