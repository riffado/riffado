import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
    parseWebhookEvents,
    serializeWebhookEndpoint,
} from "@/lib/webhooks/settings";
import { assertPublicWebhookUrl, parseWebhookUrl } from "@/lib/webhooks/url";

export async function PATCH(
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
        const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
        >;
        const updates: Partial<typeof webhookEndpoints.$inferInsert> = {
            updatedAt: new Date(),
        };

        try {
            if (body.url !== undefined) {
                updates.url = parseWebhookUrl(body.url);
                await assertPublicWebhookUrl(updates.url);
            }
            if (body.events !== undefined) {
                updates.events = parseWebhookEvents(body.events);
            }
        } catch (error) {
            return NextResponse.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Invalid webhook",
                },
                { status: 400 },
            );
        }

        if (body.enabled !== undefined) {
            if (typeof body.enabled !== "boolean") {
                return NextResponse.json(
                    { error: "enabled must be a boolean" },
                    { status: 400 },
                );
            }
            updates.enabled = body.enabled;
        }

        if (body.description !== undefined) {
            updates.description =
                typeof body.description === "string" && body.description.trim()
                    ? body.description.trim()
                    : null;
        }

        const [endpoint] = await db
            .update(webhookEndpoints)
            .set(updates)
            .where(
                and(
                    eq(webhookEndpoints.id, id),
                    eq(webhookEndpoints.userId, session.user.id),
                ),
            )
            .returning();

        if (!endpoint) {
            return NextResponse.json(
                { error: "Webhook not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({
            webhook: serializeWebhookEndpoint(endpoint),
        });
    } catch (error) {
        console.error("Error updating webhook:", error);
        return NextResponse.json(
            { error: "Failed to update webhook" },
            { status: 500 },
        );
    }
}

export async function DELETE(
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
            .delete(webhookEndpoints)
            .where(
                and(
                    eq(webhookEndpoints.id, id),
                    eq(webhookEndpoints.userId, session.user.id),
                ),
            )
            .returning({ id: webhookEndpoints.id });

        if (!endpoint) {
            return NextResponse.json(
                { error: "Webhook not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting webhook:", error);
        return NextResponse.json(
            { error: "Failed to delete webhook" },
            { status: 500 },
        );
    }
}
