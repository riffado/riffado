"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { ToggleRow } from "@/components/settings/toggle-row";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { uiText } from "@/lib/i18n";

const syncIntervalPresets = [
    { label: uiText("1 minute"), value: 60 * 1000 },
    { label: uiText("2 minutes"), value: 2 * 60 * 1000 },
    { label: uiText("5 minutes"), value: 5 * 60 * 1000 },
    { label: uiText("10 minutes"), value: 10 * 60 * 1000 },
    { label: uiText("15 minutes"), value: 15 * 60 * 1000 },
    { label: uiText("30 minutes"), value: 30 * 60 * 1000 },
    { label: uiText("1 hour"), value: 60 * 60 * 1000 },
];

const getSyncIntervalLabel = (value: number) => {
    return (
        syncIntervalPresets.find((p) => p.value === value)?.label ||
        uiText("Custom")
    );
};

export function SyncSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [syncInterval, setSyncInterval] = useState(300000);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
    const [syncOnMount, setSyncOnMount] = useState(true);
    const [syncOnVisibilityChange, setSyncOnVisibilityChange] = useState(true);
    const [syncNotifications, setSyncNotifications] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setSyncInterval(data.syncInterval ?? 300000);
                    setAutoSyncEnabled(data.autoSyncEnabled ?? true);
                    setSyncOnMount(data.syncOnMount ?? true);
                    setSyncOnVisibilityChange(
                        data.syncOnVisibilityChange ?? true,
                    );
                    setSyncNotifications(data.syncNotifications ?? true);
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleSyncSettingChange = async (updates: {
        syncInterval?: number;
        autoSyncEnabled?: boolean;
        syncOnMount?: boolean;
        syncOnVisibilityChange?: boolean;
        syncNotifications?: boolean;
    }) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.syncInterval !== undefined) {
            previousValues.syncInterval = syncInterval;
            setSyncInterval(updates.syncInterval);
        }
        if (updates.autoSyncEnabled !== undefined) {
            previousValues.autoSyncEnabled = autoSyncEnabled;
            setAutoSyncEnabled(updates.autoSyncEnabled);
        }
        if (updates.syncOnMount !== undefined) {
            previousValues.syncOnMount = syncOnMount;
            setSyncOnMount(updates.syncOnMount);
        }
        if (updates.syncOnVisibilityChange !== undefined) {
            previousValues.syncOnVisibilityChange = syncOnVisibilityChange;
            setSyncOnVisibilityChange(updates.syncOnVisibilityChange);
        }
        if (updates.syncNotifications !== undefined) {
            previousValues.syncNotifications = syncNotifications;
            setSyncNotifications(updates.syncNotifications);
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
            if (updates.syncInterval !== undefined) {
                const prev = previousValues.syncInterval;
                if (typeof prev === "number") setSyncInterval(prev);
            }
            if (updates.autoSyncEnabled !== undefined) {
                const prev = previousValues.autoSyncEnabled;
                if (typeof prev === "boolean") setAutoSyncEnabled(prev);
            }
            if (updates.syncOnMount !== undefined) {
                const prev = previousValues.syncOnMount;
                if (typeof prev === "boolean") setSyncOnMount(prev);
            }
            if (updates.syncOnVisibilityChange !== undefined) {
                const prev = previousValues.syncOnVisibilityChange;
                if (typeof prev === "boolean") setSyncOnVisibilityChange(prev);
            }
            if (updates.syncNotifications !== undefined) {
                const prev = previousValues.syncNotifications;
                if (typeof prev === "boolean") setSyncNotifications(prev);
            }
            toast.error(uiText("Failed to save settings. Changes reverted."));
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title={uiText("Sync")}
                description={uiText(
                    "When and how Riffado pulls new recordings from your Plaud device.",
                )}
                icon={RefreshCw}
            />
            <div className="space-y-3">
                <SettingsCard title={uiText("Auto-sync")}>
                    <ToggleRow
                        id="auto-sync"
                        label={uiText("Enable auto-sync")}
                        description={uiText(
                            "Automatically sync recordings from your Plaud device at regular intervals.",
                        )}
                        checked={autoSyncEnabled}
                        onCheckedChange={(checked) => {
                            setAutoSyncEnabled(checked);
                            handleSyncSettingChange({
                                autoSyncEnabled: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />

                    {autoSyncEnabled && (
                        <div className="mt-3 space-y-3 border-t pt-3">
                            <div className="space-y-2">
                                <Label htmlFor="sync-interval">
                                    {uiText("Sync interval")}
                                </Label>
                                <Select
                                    value={syncInterval.toString()}
                                    onValueChange={(value) => {
                                        const interval = parseInt(value, 10);
                                        setSyncInterval(interval);
                                        handleSyncSettingChange({
                                            syncInterval: interval,
                                        });
                                    }}
                                    disabled={isSavingSettings}
                                >
                                    <SelectTrigger
                                        id="sync-interval"
                                        className="w-full"
                                    >
                                        <SelectValue>
                                            {getSyncIntervalLabel(syncInterval)}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {syncIntervalPresets.map((preset) => (
                                            <SelectItem
                                                key={preset.value}
                                                value={preset.value.toString()}
                                            >
                                                {preset.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <ToggleRow
                                id="sync-on-mount"
                                label={uiText("Sync on app load")}
                                description={uiText(
                                    "Automatically sync when the app first loads.",
                                )}
                                checked={syncOnMount}
                                onCheckedChange={(checked) => {
                                    setSyncOnMount(checked);
                                    handleSyncSettingChange({
                                        syncOnMount: checked,
                                    });
                                }}
                                disabled={isSavingSettings}
                            />

                            <ToggleRow
                                id="sync-on-visibility"
                                label={uiText("Sync on tab visibility")}
                                description={uiText(
                                    "Sync when you return to the app tab.",
                                )}
                                checked={syncOnVisibilityChange}
                                onCheckedChange={(checked) => {
                                    setSyncOnVisibilityChange(checked);
                                    handleSyncSettingChange({
                                        syncOnVisibilityChange: checked,
                                    });
                                }}
                                disabled={isSavingSettings}
                            />
                        </div>
                    )}
                </SettingsCard>

                <SettingsCard title={uiText("Notifications")}>
                    <ToggleRow
                        id="sync-notifications"
                        label={uiText("Show sync notifications")}
                        description={uiText(
                            "Display notifications when sync completes.",
                        )}
                        checked={syncNotifications}
                        onCheckedChange={(checked) => {
                            setSyncNotifications(checked);
                            handleSyncSettingChange({
                                syncNotifications: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </SettingsCard>
            </div>
        </div>
    );
}
