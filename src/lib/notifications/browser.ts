/**
 * Browser notification utilities
 */
import { uiText } from "@/lib/i18n";

export async function requestNotificationPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
        return false;
    }

    if (Notification.permission === "granted") {
        return true;
    }

    if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        return permission === "granted";
    }

    return false;
}

export function showBrowserNotification(
    title: string,
    options?: NotificationOptions,
): void {
    if (!("Notification" in window)) {
        return;
    }

    if (Notification.permission === "granted") {
        new Notification(title, {
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            ...options,
        });
    }
}

export function showNewRecordingNotification(count: number): void {
    const title = uiText("Synced {count} new recordings", { count });

    showBrowserNotification(title, {
        body: uiText(
            "{count} new recordings have been synced from your Plaud device",
            { count },
        ),
        tag: "new-recording",
    });
}

export function showSyncCompleteNotification(): void {
    showBrowserNotification(uiText("Sync complete"), {
        body: uiText("Your recordings have been synced successfully"),
        tag: "sync-complete",
    });
}
