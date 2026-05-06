import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
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

        const { id } = await params;
        const [endpoint] = await db
            .select({ id: webhookEndpoints.id })
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

        const deliveries = await db
            .select({
                id: webhookDeliveries.id,
                event: webhookDeliveries.event,
                status: webhookDeliveries.status,
                attempts: webhookDeliveries.attempts,
                lastAttemptAt: webhookDeliveries.lastAttemptAt,
                nextAttemptAt: webhookDeliveries.nextAttemptAt,
                lastResponseStatus: webhookDeliveries.lastResponseStatus,
                lastResponseBody: webhookDeliveries.lastResponseBody,
                lastError: webhookDeliveries.lastError,
                createdAt: webhookDeliveries.createdAt,
                updatedAt: webhookDeliveries.updatedAt,
            })
            .from(webhookDeliveries)
            .where(
                and(
                    eq(webhookDeliveries.endpointId, endpoint.id),
                    eq(webhookDeliveries.userId, session.user.id),
                ),
            )
            .orderBy(desc(webhookDeliveries.createdAt))
            .limit(100);

        return NextResponse.json({ deliveries });
    } catch (error) {
        console.error("Error fetching webhook deliveries:", error);
        return NextResponse.json(
            { error: "Failed to fetch webhook deliveries" },
            { status: 500 },
        );
    }
}
