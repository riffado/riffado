import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { createStoredWebhookPayload } from "@/lib/webhooks/payload";
import { signalWebhookWorker } from "@/lib/webhooks/worker";

export const WEBHOOK_EVENTS = [
    "recording.synced",
    "recording.updated",
    "recording.deleted",
    "transcription.completed",
    "transcription.failed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
    return WEBHOOK_EVENTS.includes(value as WebhookEvent);
}

export async function emitEvent(
    event: WebhookEvent,
    userId: string,
    recordingId: string,
    options: { error?: string } = {},
): Promise<void> {
    try {
        const endpoints = await db
            .select({ id: webhookEndpoints.id })
            .from(webhookEndpoints)
            .where(
                and(
                    eq(webhookEndpoints.userId, userId),
                    eq(webhookEndpoints.enabled, true),
                    sql`${webhookEndpoints.events} @> ${JSON.stringify([event])}::jsonb`,
                ),
            );

        if (endpoints.length === 0) return;

        const payload = createStoredWebhookPayload(event, recordingId, options);

        await db.insert(webhookDeliveries).values(
            endpoints.map((endpoint) => ({
                endpointId: endpoint.id,
                userId,
                recordingId,
                event,
                payload,
                status: "pending",
                nextAttemptAt: new Date(),
            })),
        );

        signalWebhookWorker();
    } catch (error) {
        console.error(`Failed to emit webhook event ${event}:`, error);
    }
}
