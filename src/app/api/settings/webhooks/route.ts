import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { auth } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/emit";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import {
    parseWebhookEvents,
    serializeWebhookEndpoint,
} from "@/lib/webhooks/settings";
import { assertPublicWebhookUrl, parseWebhookUrl } from "@/lib/webhooks/url";

export async function GET(request: Request) {
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

        const endpoints = await db
            .select()
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.userId, session.user.id))
            .orderBy(desc(webhookEndpoints.createdAt));

        return NextResponse.json({
            webhooks: endpoints.map(serializeWebhookEndpoint),
            events: WEBHOOK_EVENTS,
        });
    } catch (error) {
        console.error("Error fetching webhooks:", error);
        return NextResponse.json(
            { error: "Failed to fetch webhooks" },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
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

        const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
        >;

        let url: string;
        let events: string[];
        try {
            url = parseWebhookUrl(body.url);
            await assertPublicWebhookUrl(url);
            events = parseWebhookEvents(body.events);
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

        const secret = `whsec_${nanoid(32)}`;
        const encryptedSecret = encryptWebhookSecret(secret);
        const [endpoint] = await db
            .insert(webhookEndpoints)
            .values({
                userId: session.user.id,
                url,
                secret: encryptedSecret,
                events,
                description:
                    typeof body.description === "string" &&
                    body.description.trim()
                        ? body.description.trim()
                        : null,
                enabled:
                    typeof body.enabled === "boolean" ? body.enabled : true,
            })
            .returning();

        return NextResponse.json(
            {
                webhook: serializeWebhookEndpoint(endpoint),
                secret,
            },
            { status: 201 },
        );
    } catch (error) {
        console.error("Error creating webhook:", error);
        return NextResponse.json(
            { error: "Failed to create webhook" },
            { status: 500 },
        );
    }
}
