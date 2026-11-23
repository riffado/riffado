/** Plain words for each webhook event, as the settings UI shows them. */
const EVENT_LABELS: Record<string, string> = {
    "recording.synced": "A recording syncs",
    "recording.updated": "A recording is renamed or changed",
    "recording.deleted": "A recording is deleted",
    "transcription.completed": "A transcript is ready",
    "transcription.failed": "Transcription fails",
    "summary.completed": "A summary is ready",
    "summary.failed": "A summary fails",
};

/**
 * "transcription.completed" -> "A transcript is ready". Events this build
 * doesn't know read as their id in words ("Recording archived").
 */
export function webhookEventLabel(event: string): string {
    const known = EVENT_LABELS[event];
    if (known) return known;
    const words = event.replace(/[._]/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a delivery stands, in a word, with the dot tone that marks it. */
export function deliveryState(delivery: { status: string; attempts: number }): {
    label: string;
    tone: "ready" | "working" | "attention" | "idle";
} {
    switch (delivery.status) {
        case "success":
            return { label: "Delivered", tone: "ready" };
        case "dead":
            return { label: "Failed", tone: "attention" };
        case "processing":
            return { label: "Sending", tone: "working" };
        default:
            return delivery.attempts > 0
                ? { label: "Retrying", tone: "working" }
                : { label: "Queued", tone: "idle" };
    }
}

/** "1 try", "6 tries". */
export function triesLabel(attempts: number): string {
    return attempts === 1 ? "1 try" : `${attempts} tries`;
}
