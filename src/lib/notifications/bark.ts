import { env } from "@/lib/env";

interface BarkNotificationOptions {
    title?: string;
    subtitle?: string;
    body: string;
    badge?: number;
    sound?: string;
    icon?: string;
    group?: string;
    url?: string;
    level?: "critical" | "active" | "timeSensitive" | "passive";
    volume?: number;
    copy?: string;
    autoCopy?: boolean;
    call?: boolean;
    isArchive?: boolean;
    id?: string;
    delete?: boolean;
}

/**
 * Send a push notification via Bark with timeout
 * Times out after 3 seconds to avoid blocking sync
 */
export async function sendBarkNotification(
    pushUrl: string,
    options: BarkNotificationOptions,
    timeoutMs: number = 3000,
): Promise<boolean> {
    const payload: Record<string, unknown> = {
        body: options.body,
    };

    if (options.title) payload.title = options.title;
    if (options.subtitle) payload.subtitle = options.subtitle;
    if (options.badge !== undefined) payload.badge = options.badge;
    if (options.sound) payload.sound = options.sound;
    if (options.icon) payload.icon = options.icon;
    if (options.group) payload.group = options.group;
    if (options.url) payload.url = options.url;
    if (options.level) payload.level = options.level;
    if (options.volume !== undefined) payload.volume = options.volume;
    if (options.copy) payload.copy = options.copy;
    if (options.autoCopy) payload.autoCopy = "1";
    if (options.call) payload.call = "1";
    if (options.isArchive !== undefined)
        payload.isArchive = options.isArchive ? 1 : 0;
    if (options.id) payload.id = options.id;
    if (options.delete) payload.delete = "1";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(pushUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response
                .text()
                .catch(() => "Unknown error");
            console.error(`Bark API error: ${response.status} ${errorText}`);
            return false;
        }

        return true;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
            console.warn("Bark notification timed out after 3 seconds");
        } else {
            console.error("Failed to send Bark notification:", error);
        }
        return false;
    }
}

/**
 * Send a notification for new recordings synced with timeout
 */
export async function sendNewRecordingBarkNotification(
    pushUrl: string,
    count: number,
    recordingNames?: string[],
    timeoutMs: number = 3000,
): Promise<boolean> {
    const baseUrl = env.APP_URL;
    const dashboardUrl = `${baseUrl}/dashboard`;

    const title =
        count === 1 ? "New recording synced" : `${count} new recordings synced`;

    const body =
        count === 1
            ? "A new recording has been synced from your Plaud device"
            : `${count} new recordings have been synced from your Plaud device`;

    const subtitle =
        recordingNames && recordingNames.length > 0
            ? recordingNames.slice(0, 3).join(", ") +
              (recordingNames.length > 3 ? "..." : "")
            : undefined;

    return sendBarkNotification(
        pushUrl,
        {
            title,
            subtitle,
            body,
            url: dashboardUrl,
            group: "riffado-recordings",
            sound: "minuet",
            badge: count,
        },
        timeoutMs,
    );
}
