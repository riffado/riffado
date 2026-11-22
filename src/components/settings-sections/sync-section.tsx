"use client";

import { useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
    ToggleRow,
} from "@/components/settings/toggle-row";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

const syncIntervalPresets = [
    { label: "1 minute", value: 60 * 1000 },
    { label: "2 minutes", value: 2 * 60 * 1000 },
    { label: "5 minutes", value: 5 * 60 * 1000 },
    { label: "10 minutes", value: 10 * 60 * 1000 },
    { label: "15 minutes", value: 15 * 60 * 1000 },
    { label: "30 minutes", value: 30 * 60 * 1000 },
    { label: "1 hour", value: 60 * 60 * 1000 },
];

const getSyncIntervalLabel = (value: number) => {
    return (
        syncIntervalPresets.find((p) => p.value === value)?.label || "Custom"
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
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    return (
        <SettingsGroup title="Sync">
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={5} />
            ) : (
                <SettingsRows>
                    <ToggleRow
                        id="auto-sync"
                        label="Sync automatically"
                        description="Checks your Plaud account for new recordings"
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
                        <SettingsRow
                            label="Every"
                            description="How often Riffado checks"
                            controlId="sync-interval"
                            control={
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
                                    <SettingsSelectTrigger id="sync-interval">
                                        <SelectValue>
                                            {getSyncIntervalLabel(syncInterval)}
                                        </SelectValue>
                                    </SettingsSelectTrigger>
                                    <SelectContent align="end">
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
                            }
                        />
                    )}

                    {autoSyncEnabled && (
                        <ToggleRow
                            id="sync-on-mount"
                            label="Sync when Riffado opens"
                            description="Catches up as soon as you open the app"
                            checked={syncOnMount}
                            onCheckedChange={(checked) => {
                                setSyncOnMount(checked);
                                handleSyncSettingChange({
                                    syncOnMount: checked,
                                });
                            }}
                            disabled={isSavingSettings}
                        />
                    )}

                    {autoSyncEnabled && (
                        <ToggleRow
                            id="sync-on-visibility"
                            label="Sync when you come back"
                            description="Checks again when you return to this tab"
                            checked={syncOnVisibilityChange}
                            onCheckedChange={(checked) => {
                                setSyncOnVisibilityChange(checked);
                                handleSyncSettingChange({
                                    syncOnVisibilityChange: checked,
                                });
                            }}
                            disabled={isSavingSettings}
                        />
                    )}

                    <ToggleRow
                        id="sync-notifications"
                        label="Sync notifications"
                        description="A message when a sync finishes"
                        checked={syncNotifications}
                        onCheckedChange={(checked) => {
                            setSyncNotifications(checked);
                            handleSyncSettingChange({
                                syncNotifications: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </SettingsRows>
            )}
        </SettingsGroup>
    );
}
