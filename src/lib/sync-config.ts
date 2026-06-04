export const SYNC_CONFIG = {
    defaultInterval: parseInt(
        process.env.NEXT_PUBLIC_SYNC_INTERVAL || "300000",
        10,
    ),
    minInterval: parseInt(
        process.env.NEXT_PUBLIC_MIN_SYNC_INTERVAL || "60000",
        10,
    ),
    syncOnMount: process.env.NEXT_PUBLIC_SYNC_ON_MOUNT !== "false",
    syncOnVisibilityChange:
        process.env.NEXT_PUBLIC_SYNC_ON_VISIBILITY !== "false",
    intervalPresets: {
        "1 minute": 60 * 1000,
        "2 minutes": 2 * 60 * 1000,
        "5 minutes": 5 * 60 * 1000,
        "10 minutes": 10 * 60 * 1000,
        "15 minutes": 15 * 60 * 1000,
        "30 minutes": 30 * 60 * 1000,
        "1 hour": 60 * 60 * 1000,
    },
} as const;

export async function getSyncSettings(): Promise<{
    syncInterval: number;
    autoSyncEnabled: boolean;
    syncOnMount: boolean;
    syncOnVisibilityChange: boolean;
    syncNotifications: boolean;
}> {
    if (typeof window === "undefined") {
        return {
            syncInterval: SYNC_CONFIG.defaultInterval,
            autoSyncEnabled: true,
            syncOnMount: SYNC_CONFIG.syncOnMount,
            syncOnVisibilityChange: SYNC_CONFIG.syncOnVisibilityChange,
            syncNotifications: true,
        };
    }

    try {
        const response = await fetch("/api/settings/user");
        if (response.ok) {
            const data = await response.json();
            return {
                syncInterval: data.syncInterval ?? SYNC_CONFIG.defaultInterval,
                autoSyncEnabled: data.autoSyncEnabled ?? true,
                syncOnMount: data.syncOnMount ?? SYNC_CONFIG.syncOnMount,
                syncOnVisibilityChange:
                    data.syncOnVisibilityChange ??
                    SYNC_CONFIG.syncOnVisibilityChange,
                syncNotifications: data.syncNotifications ?? true,
            };
        }
    } catch (error) {
        console.error("Failed to fetch sync settings:", error);
    }

    const storedInterval = localStorage.getItem("mesynx-ai_sync_interval");
    const storedEnabled = localStorage.getItem("mesynx-ai_auto_sync_enabled");

    return {
        syncInterval: storedInterval
            ? parseInt(storedInterval, 10)
            : SYNC_CONFIG.defaultInterval,
        autoSyncEnabled:
            storedEnabled === null ? true : storedEnabled === "true",
        syncOnMount: SYNC_CONFIG.syncOnMount,
        syncOnVisibilityChange: SYNC_CONFIG.syncOnVisibilityChange,
        syncNotifications: true,
    };
}
