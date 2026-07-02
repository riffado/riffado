import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailDeliveries } from "@/db/schema";

export type DeliveryStatus =
    | "pending"
    | "sent"
    | "failed"
    | "skipped_no_consent"
    | "skipped_suppressed"
    | "skipped_invalid_email";

interface ClaimInput {
    campaignId: string;
    email: string;
    userId: string | null;
    subscriberId: string | null;
}

/** Atomically claim a delivery row for `(campaignId, email)`. Null = already attempted. */
export async function claimDelivery(
    input: ClaimInput,
): Promise<{ id: string } | null> {
    const inserted = await db
        .insert(emailDeliveries)
        .values({
            campaignId: input.campaignId,
            userId: input.userId,
            subscriberId: input.subscriberId,
            email: input.email,
            status: "pending",
        })
        .onConflictDoNothing({
            target: [emailDeliveries.campaignId, emailDeliveries.email],
        })
        .returning({ id: emailDeliveries.id });

    return inserted[0] ?? null;
}

export async function markDeliverySent(
    deliveryId: string,
    messageId: string | undefined,
): Promise<void> {
    await db
        .update(emailDeliveries)
        .set({
            status: "sent",
            messageId: messageId ?? null,
            sentAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, deliveryId));
}

export async function markDeliveryFailed(
    deliveryId: string,
    error: string,
): Promise<void> {
    await db
        .update(emailDeliveries)
        .set({
            status: "failed",
            error: error.slice(0, 2000),
            updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, deliveryId));
}

export async function markDeliverySkipped(
    deliveryId: string,
    status: Extract<
        DeliveryStatus,
        "skipped_no_consent" | "skipped_suppressed" | "skipped_invalid_email"
    >,
    note: string | undefined,
): Promise<void> {
    await db
        .update(emailDeliveries)
        .set({
            status,
            error: note ?? null,
            updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, deliveryId));
}

export interface CampaignSummary {
    attempted: number;
    sent: number;
    failed: number;
    skipped: number;
    pending: number;
}

export async function summarizeCampaign(
    campaignId: string,
): Promise<CampaignSummary> {
    const rows = await db
        .select({
            status: emailDeliveries.status,
            count: sql<number>`count(*)::int`,
        })
        .from(emailDeliveries)
        .where(eq(emailDeliveries.campaignId, campaignId))
        .groupBy(emailDeliveries.status);

    const summary: CampaignSummary = {
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
    };

    for (const row of rows) {
        const count = Number(row.count);
        summary.attempted += count;
        if (row.status === "sent") summary.sent += count;
        else if (row.status === "failed") summary.failed += count;
        else if (row.status === "pending") summary.pending += count;
        else if (row.status.startsWith("skipped_")) summary.skipped += count;
    }

    return summary;
}

export async function hasDelivery(
    campaignId: string,
    email: string,
): Promise<boolean> {
    const rows = await db
        .select({ id: emailDeliveries.id })
        .from(emailDeliveries)
        .where(
            and(
                eq(emailDeliveries.campaignId, campaignId),
                eq(emailDeliveries.email, email),
            ),
        )
        .limit(1);
    return rows.length > 0;
}
