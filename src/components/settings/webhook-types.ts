/**
 * Shared types for the webhooks settings UI.
 *
 * Lives in its own file (not co-located with WebhooksSection) so the editor
 * and deliveries dialogs can import without pulling in the parent component.
 */

export type WebhookEndpoint = {
    id: string;
    url: string;
    secret: string;
    events: string[];
    description: string | null;
    enabled: boolean;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: string | null;
    createdAt: string;
};

export type WebhookDelivery = {
    id: string;
    event: string;
    status: string;
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string;
    lastResponseStatus: number | null;
    lastError: string | null;
    createdAt: string;
};

export const DEFAULT_WEBHOOK_EVENTS = [
    "recording.synced",
    "recording.updated",
    "recording.deleted",
    "transcription.completed",
    "transcription.failed",
    "summary.completed",
    "summary.failed",
];

export function formatWebhookDate(value: string | null): string {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
}
