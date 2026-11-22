"use client";

import { useEffect, useRef, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
} from "@/components/settings/toggle-row";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

const dateTimeFormatOptions = [
    {
        label: "Relative",
        value: "relative",
        description: "e.g., 2 hours ago",
    },
    {
        label: "Absolute",
        value: "absolute",
        description: "e.g., Jan 15, 2024 3:45 PM",
    },
    {
        label: "ISO",
        value: "iso",
        description: "e.g., 2024-01-15T15:45:00Z",
    },
];

const sortOrderOptions = [
    { label: "Newest first", value: "newest" },
    { label: "Oldest first", value: "oldest" },
    { label: "By name", value: "name" },
];

const themeOptions = [
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
    {
        label: "System",
        value: "system",
        description: "Follow system preference",
    },
];

export function DisplaySection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [dateTimeFormat, setDateTimeFormat] = useState("relative");
    const [recordingListSortOrder, setRecordingListSortOrder] =
        useState("newest");
    const [itemsPerPage, setItemsPerPage] = useState(50);
    const [theme, setTheme] = useState("system");
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setDateTimeFormat(data.dateTimeFormat ?? "relative");
                    setRecordingListSortOrder(
                        data.recordingListSortOrder ?? "newest",
                    );
                    setItemsPerPage(data.itemsPerPage ?? 50);
                    setTheme(data.theme ?? "system");
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    const handleDisplaySettingChange = async (
        updates: {
            dateTimeFormat?: string;
            recordingListSortOrder?: string;
            itemsPerPage?: number;
            theme?: string;
        },
        debounceMs?: number,
    ) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.dateTimeFormat !== undefined) {
            previousValues.dateTimeFormat = dateTimeFormat;
            setDateTimeFormat(updates.dateTimeFormat);
        }
        if (updates.recordingListSortOrder !== undefined) {
            previousValues.recordingListSortOrder = recordingListSortOrder;
            setRecordingListSortOrder(updates.recordingListSortOrder);
        }
        if (updates.itemsPerPage !== undefined) {
            previousValues.itemsPerPage = itemsPerPage;
            setItemsPerPage(updates.itemsPerPage);
        }
        if (updates.theme !== undefined) {
            previousValues.theme = theme;
            setTheme(updates.theme);
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const performSave = async () => {
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
                if (updates.dateTimeFormat !== undefined) {
                    const prev = previousValues.dateTimeFormat;
                    if (typeof prev === "string") setDateTimeFormat(prev);
                }
                if (updates.recordingListSortOrder !== undefined) {
                    const prev = previousValues.recordingListSortOrder;
                    if (typeof prev === "string")
                        setRecordingListSortOrder(prev);
                }
                if (updates.itemsPerPage !== undefined) {
                    const prev = previousValues.itemsPerPage;
                    if (typeof prev === "number") setItemsPerPage(prev);
                }
                if (updates.theme !== undefined) {
                    const prev = previousValues.theme;
                    if (typeof prev === "string") setTheme(prev);
                }
                toast.error("Failed to save settings. Changes reverted.");
            }
        };

        if (debounceMs) {
            saveTimeoutRef.current = setTimeout(performSave, debounceMs);
        } else {
            performSave();
        }
    };

    return (
        <SettingsGroup
            title="Display"
            description="How dates, lists and the app look"
        >
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={4} />
            ) : (
                <SettingsRows>
                    <SettingsRow
                        label="Dates and times"
                        controlId="date-time-format"
                        control={
                            <Select
                                value={dateTimeFormat}
                                onValueChange={(value) => {
                                    setDateTimeFormat(value);
                                    handleDisplaySettingChange({
                                        dateTimeFormat: value,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="date-time-format">
                                    <SelectValue>
                                        {dateTimeFormatOptions.find(
                                            (opt) =>
                                                opt.value === dateTimeFormat,
                                        )?.label || "Relative"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {dateTimeFormatOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            <div>
                                                <div>{option.label}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {option.description}
                                                </div>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                    <SettingsRow
                        label="Recording order"
                        controlId="sort-order"
                        control={
                            <Select
                                value={recordingListSortOrder}
                                onValueChange={(value) => {
                                    setRecordingListSortOrder(value);
                                    handleDisplaySettingChange({
                                        recordingListSortOrder: value,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="sort-order">
                                    <SelectValue>
                                        {sortOrderOptions.find(
                                            (opt) =>
                                                opt.value ===
                                                recordingListSortOrder,
                                        )?.label || "Newest first"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {sortOrderOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                    <SettingsRow
                        label="Recordings per page"
                        description="Between 10 and 100"
                        controlId="items-per-page"
                        control={
                            <Input
                                id="items-per-page"
                                type="number"
                                min={10}
                                max={100}
                                value={itemsPerPage}
                                onChange={(e) => {
                                    const value = parseInt(e.target.value, 10);
                                    if (
                                        !Number.isNaN(value) &&
                                        value >= 10 &&
                                        value <= 100
                                    ) {
                                        setItemsPerPage(value);
                                        handleDisplaySettingChange(
                                            { itemsPerPage: value },
                                            500,
                                        );
                                    }
                                }}
                                className="squircle h-9.5 w-24 rounded-[var(--radius-control)] border-border text-right tabular-nums"
                            />
                        }
                    />
                    <SettingsRow
                        label="Theme"
                        controlId="theme"
                        control={
                            <Select
                                value={theme}
                                onValueChange={(value) => {
                                    setTheme(value);
                                    handleDisplaySettingChange({
                                        theme: value,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="theme">
                                    <SelectValue>
                                        {themeOptions.find(
                                            (opt) => opt.value === theme,
                                        )?.label || "System"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {themeOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            <div>
                                                <div>{option.label}</div>
                                                {option.description && (
                                                    <div className="text-xs text-muted-foreground">
                                                        {option.description}
                                                    </div>
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                </SettingsRows>
            )}
        </SettingsGroup>
    );
}
