import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { auth } from "@/lib/auth";
import { signalWebhookWorker } from "@/lib/webhooks/worker";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id, deliveryId } = await params;
        const [endpoint] = await db
            .select({
                id: webhookEndpoints.id,
                enabled: webhookEndpoints.enabled,
            })
            .from(webhookEndpoints)
            .where(
                and(
                    eq(webhookEndpoints.id, id),
                    eq(webhookEndpoints.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!endpoint) {
            return NextResponse.json(
                { error: "Webhook not found" },
                { status: 404 },
            );
        }
        if (!endpoint.enabled) {
            return NextResponse.json(
                { error: "Webhook is disabled" },
                { status: 409 },
            );
        }

        const [delivery] = await db
            .update(webhookDeliveries)
            .set({
                status: "pending",
                nextAttemptAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(webhookDeliveries.id, deliveryId),
                    eq(webhookDeliveries.endpointId, endpoint.id),
                    eq(webhookDeliveries.userId, session.user.id),
                ),
            )
            .returning({ id: webhookDeliveries.id });

        if (!delivery) {
            return NextResponse.json(
                { error: "Delivery not found" },
                { status: 404 },
            );
        }

        signalWebhookWorker();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error redelivering webhook:", error);
        return NextResponse.json(
            { error: "Failed to redeliver webhook" },
            { status: 500 },
        );
    }
}
