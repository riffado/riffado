import type { webhookEndpoints } from "@/db/schema";
import { isWebhookEvent, WEBHOOK_EVENTS } from "@/lib/webhooks/emit";
import {
    decryptWebhookUrl,
    maskStoredWebhookSecret,
} from "@/lib/webhooks/secrets";

export function serializeWebhookEndpoint(
    endpoint: typeof webhookEndpoints.$inferSelect,
) {
    return {
        id: endpoint.id,
        url: decryptWebhookUrl(endpoint.url),
        secret: maskStoredWebhookSecret(endpoint.secret),
        events: endpoint.events,
        description: endpoint.description,
        enabled: endpoint.enabled,
        lastDeliveryAt: endpoint.lastDeliveryAt,
        lastDeliveryStatus: endpoint.lastDeliveryStatus,
        createdAt: endpoint.createdAt,
        updatedAt: endpoint.updatedAt,
    };
}

export function parseWebhookEvents(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error("events must be an array");

    const events = value.filter((event): event is string => {
        return typeof event === "string" && isWebhookEvent(event);
    });

    if (events.length === 0) {
        throw new Error(
            `events must include at least one of: ${WEBHOOK_EVENTS.join(", ")}`,
        );
    }

    return Array.from(new Set(events));
}
