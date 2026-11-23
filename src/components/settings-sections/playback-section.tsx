"use client";

import { useEffect, useRef, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

const playbackSpeedOptions = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
];

export function PlaybackSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [defaultPlaybackSpeed, setDefaultPlaybackSpeed] = useState(1.0);
    const [defaultVolume, setDefaultVolume] = useState(75);
    const [autoPlayNext, setAutoPlayNext] = useState(false);
    const [playerScrubber, setPlayerScrubber] = useState<"waveform" | "slider">(
        "waveform",
    );
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setDefaultPlaybackSpeed(data.defaultPlaybackSpeed ?? 1.0);
                    setDefaultVolume(data.defaultVolume ?? 75);
                    setAutoPlayNext(data.autoPlayNext ?? false);
                    setPlayerScrubber(
                        data.playerScrubber === "slider"
                            ? "slider"
                            : "waveform",
                    );
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

    const handlePlaybackSettingChange = async (
        updates: {
            defaultPlaybackSpeed?: number;
            defaultVolume?: number;
            autoPlayNext?: boolean;
            playerScrubber?: "waveform" | "slider";
        },
        debounceMs?: number,
    ) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.defaultPlaybackSpeed !== undefined) {
            previousValues.defaultPlaybackSpeed = defaultPlaybackSpeed;
            setDefaultPlaybackSpeed(updates.defaultPlaybackSpeed);
        }
        if (updates.defaultVolume !== undefined) {
            previousValues.defaultVolume = defaultVolume;
            setDefaultVolume(updates.defaultVolume);
        }
        if (updates.autoPlayNext !== undefined) {
            previousValues.autoPlayNext = autoPlayNext;
            setAutoPlayNext(updates.autoPlayNext);
        }
        if (updates.playerScrubber !== undefined) {
            previousValues.playerScrubber = playerScrubber;
            setPlayerScrubber(updates.playerScrubber);
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
                if (updates.defaultPlaybackSpeed !== undefined) {
                    const prev = previousValues.defaultPlaybackSpeed;
                    if (typeof prev === "number") setDefaultPlaybackSpeed(prev);
                }
                if (updates.defaultVolume !== undefined) {
                    const prev = previousValues.defaultVolume;
                    if (typeof prev === "number") setDefaultVolume(prev);
                }
                if (updates.autoPlayNext !== undefined) {
                    const prev = previousValues.autoPlayNext;
                    if (typeof prev === "boolean") setAutoPlayNext(prev);
                }
                if (updates.playerScrubber !== undefined) {
                    const prev = previousValues.playerScrubber;
                    if (prev === "waveform" || prev === "slider") {
                        setPlayerScrubber(prev);
                    }
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

    const shortcuts: { keys: string; description: string }[] = [
        { keys: "Space", description: "Play / pause" },
        { keys: "←", description: "Skip back 10 seconds" },
        { keys: "→", description: "Skip forward 10 seconds" },
        { keys: "↑", description: "Increase volume" },
        { keys: "↓", description: "Decrease volume" },
    ];

    return (
        <SettingsGroup
            title="Playback"
            description="Applied to every recording when it opens in the player"
        >
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={4} />
            ) : (
                <SettingsRows>
                    <SettingsRow
                        label="Speed"
                        controlId="playback-speed"
                        control={
                            <Select
                                value={defaultPlaybackSpeed.toString()}
                                onValueChange={(value) => {
                                    const speed = parseFloat(value);
                                    setDefaultPlaybackSpeed(speed);
                                    handlePlaybackSettingChange({
                                        defaultPlaybackSpeed: speed,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="playback-speed">
                                    <SelectValue>
                                        {playbackSpeedOptions.find(
                                            (opt) =>
                                                opt.value ===
                                                defaultPlaybackSpeed,
                                        )?.label || "1x"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {playbackSpeedOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value.toString()}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                    <SettingsRow
                        label="Volume"
                        controlId="default-volume"
                        control={
                            <div className="flex w-56 items-center gap-3 max-sm:w-44">
                                <Slider
                                    id="default-volume"
                                    value={[defaultVolume]}
                                    onValueChange={(value) => {
                                        const volume = value[0] ?? 75;
                                        setDefaultVolume(volume);
                                        handlePlaybackSettingChange(
                                            { defaultVolume: volume },
                                            500,
                                        );
                                    }}
                                    min={0}
                                    max={100}
                                    step={1}
                                />
                                <span className="w-10 shrink-0 text-right text-small text-subtle tabular-nums">
                                    {defaultVolume}%
                                </span>
                            </div>
                        }
                    />
                    <ToggleRow
                        id="auto-play-next"
                        label="Play the next recording"
                        description="Starts the next one when the current recording ends"
                        checked={autoPlayNext}
                        onCheckedChange={(checked) => {
                            setAutoPlayNext(checked);
                            handlePlaybackSettingChange({
                                autoPlayNext: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                    <SettingsRow
                        label="Scrubber"
                        description="The waveform decodes audio in the browser on first listen. The progress bar skips that"
                        controlId="player-scrubber"
                        control={
                            <Select
                                value={playerScrubber}
                                onValueChange={(value) => {
                                    const next =
                                        value === "slider"
                                            ? "slider"
                                            : "waveform";
                                    handlePlaybackSettingChange({
                                        playerScrubber: next,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="player-scrubber">
                                    <SelectValue />
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    <SelectItem value="waveform">
                                        Waveform
                                    </SelectItem>
                                    <SelectItem value="slider">
                                        Progress bar
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        }
                    />
                    <SettingsRow
                        label="Keyboard shortcuts"
                        description="When the player has focus"
                    >
                        <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                            {shortcuts.map((s) => (
                                <li
                                    key={s.keys}
                                    className="flex items-center justify-between gap-3 text-ui text-foreground"
                                >
                                    <span>{s.description}</span>
                                    <kbd className="squircle inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-small)] bg-accent px-1.5 font-sans text-xs text-subtle">
                                        {s.keys}
                                    </kbd>
                                </li>
                            ))}
                        </ul>
                    </SettingsRow>
                </SettingsRows>
            )}
        </SettingsGroup>
    );
}
