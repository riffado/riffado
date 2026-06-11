import type { userSettings } from "@/db/schema";

export interface InitialSettings {
    dateTimeFormat: "relative" | "absolute" | "iso";
    recordingListSortOrder: "newest" | "oldest" | "name";
    itemsPerPage: number;
    listDensity: "comfortable" | "compact";
    theme: "light" | "dark" | "system";
    defaultPlaybackSpeed: number;
    defaultVolume: number;
    autoPlayNext: boolean;
    playerScrubber: "waveform" | "slider";
    syncInterval: number;
    autoSyncEnabled: boolean;
    syncOnMount: boolean;
    syncOnVisibilityChange: boolean;
    syncNotifications: boolean;
    browserNotifications: boolean;
}

export const INITIAL_SETTINGS_DEFAULTS: InitialSettings = {
    dateTimeFormat: "relative",
    recordingListSortOrder: "newest",
    itemsPerPage: 50,
    listDensity: "comfortable",
    theme: "system",
    defaultPlaybackSpeed: 1.0,
    defaultVolume: 75,
    autoPlayNext: false,
    playerScrubber: "waveform",
    syncInterval: 300_000,
    autoSyncEnabled: true,
    syncOnMount: true,
    syncOnVisibilityChange: true,
    syncNotifications: true,
    browserNotifications: true,
};

type Row = typeof userSettings.$inferSelect | undefined | null;

export function initialSettingsFromRow(row: Row): InitialSettings {
    const r = row ?? undefined;
    return {
        dateTimeFormat: (r?.dateTimeFormat ??
            INITIAL_SETTINGS_DEFAULTS.dateTimeFormat) as InitialSettings["dateTimeFormat"],
        recordingListSortOrder: (r?.recordingListSortOrder ??
            INITIAL_SETTINGS_DEFAULTS.recordingListSortOrder) as InitialSettings["recordingListSortOrder"],
        itemsPerPage: r?.itemsPerPage ?? INITIAL_SETTINGS_DEFAULTS.itemsPerPage,
        listDensity: (r?.listDensity ??
            INITIAL_SETTINGS_DEFAULTS.listDensity) as InitialSettings["listDensity"],
        theme: (r?.theme ??
            INITIAL_SETTINGS_DEFAULTS.theme) as InitialSettings["theme"],
        defaultPlaybackSpeed:
            r?.defaultPlaybackSpeed ??
            INITIAL_SETTINGS_DEFAULTS.defaultPlaybackSpeed,
        defaultVolume:
            r?.defaultVolume ?? INITIAL_SETTINGS_DEFAULTS.defaultVolume,
        autoPlayNext: r?.autoPlayNext ?? INITIAL_SETTINGS_DEFAULTS.autoPlayNext,
        playerScrubber: (r?.playerScrubber ??
            INITIAL_SETTINGS_DEFAULTS.playerScrubber) as InitialSettings["playerScrubber"],
        syncInterval: r?.syncInterval ?? INITIAL_SETTINGS_DEFAULTS.syncInterval,
        autoSyncEnabled:
            r?.autoSyncEnabled ?? INITIAL_SETTINGS_DEFAULTS.autoSyncEnabled,
        syncOnMount: r?.syncOnMount ?? INITIAL_SETTINGS_DEFAULTS.syncOnMount,
        syncOnVisibilityChange:
            r?.syncOnVisibilityChange ??
            INITIAL_SETTINGS_DEFAULTS.syncOnVisibilityChange,
        syncNotifications:
            r?.syncNotifications ?? INITIAL_SETTINGS_DEFAULTS.syncNotifications,
        browserNotifications:
            r?.browserNotifications ??
            INITIAL_SETTINGS_DEFAULTS.browserNotifications,
    };
}
