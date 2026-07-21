import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
    type CampaignKind,
    normalizeCampaignKind,
} from "@/db/queries/email-campaigns";
import type { DeliveryStatus } from "@/db/queries/email-deliveries";
import {
    emailCampaigns,
    emailDeliveries,
    emailSuppressions,
    newsletterSubscriptions,
} from "@/db/schema";

type SkippedStatus = Extract<DeliveryStatus, `skipped_${string}`>;

/**
 * Exhaustive by construction: `Record<SkippedStatus, true>` requires every
 * member of the `skipped_*` union as a key, so adding a new skip reason to
 * `DeliveryStatus` in `email-deliveries.ts` without adding it here is a
 * type error, not a silent gap.
 */
const SKIPPED_STATUS_SET: Record<SkippedStatus, true> = {
    skipped_no_consent: true,
    skipped_suppressed: true,
    skipped_invalid_email: true,
};
const SKIPPED_STATUSES = Object.keys(SKIPPED_STATUS_SET) as SkippedStatus[];

export interface CampaignOverviewRow {
    id: string;
    slug: string;
    subject: string;
    kind: CampaignKind;
    createdAt: Date;
    attempted: number;
    sent: number;
    failed: number;
    skipped: number;
    pending: number;
    /**
     * Deliveries whose `status` didn't match any of the known buckets above.
     * `emailDeliveries.status` is a bare `varchar`, not a DB enum, so a
     * future status string (or manual DB edit) can silently fall through
     * the `sent`/`failed`/`skipped_*`/`pending` filters. Surfacing the
     * remainder here keeps `sent + failed + skipped + pending + other`
     * always equal to `attempted` instead of quietly under-counting.
     */
    other: number;
}

/**
 * Campaigns joined with delivery status counts, newest first. Statuses are
 * pivoted with `filter` aggregates rather than a per-campaign N+1 query.
 */
export async function listCampaignsOverview(
    limit = 50,
): Promise<CampaignOverviewRow[]> {
    const rows = await db
        .select({
            id: emailCampaigns.id,
            slug: emailCampaigns.slug,
            subject: emailCampaigns.subject,
            kind: emailCampaigns.kind,
            createdAt: emailCampaigns.createdAt,
            attempted: count(emailDeliveries.id),
            sent: sql<number>`count(*) filter (where ${emailDeliveries.status} = 'sent')::int`,
            failed: sql<number>`count(*) filter (where ${emailDeliveries.status} = 'failed')::int`,
            // Exact match against the known `skipped_*` literals, not a
            // `LIKE 'skipped_%'` pattern -- in SQL LIKE, `_` is a
            // single-character wildcard, so that pattern also matched
            // unrelated strings like `skippedX...` and would have folded an
            // unknown status into `skipped` instead of surfacing it via
            // `other`.
            skipped: sql<number>`count(*) filter (where ${inArray(emailDeliveries.status, SKIPPED_STATUSES)})::int`,
            pending: sql<number>`count(*) filter (where ${emailDeliveries.status} = 'pending')::int`,
        })
        .from(emailCampaigns)
        .leftJoin(
            emailDeliveries,
            eq(emailDeliveries.campaignId, emailCampaigns.id),
        )
        .groupBy(
            emailCampaigns.id,
            emailCampaigns.slug,
            emailCampaigns.subject,
            emailCampaigns.kind,
            emailCampaigns.createdAt,
        )
        .orderBy(desc(emailCampaigns.createdAt))
        .limit(limit);

    return rows.map((r) => {
        const attempted = Number(r.attempted);
        const sent = Number(r.sent);
        const failed = Number(r.failed);
        const skipped = Number(r.skipped);
        const pending = Number(r.pending);
        return {
            id: r.id,
            slug: r.slug,
            subject: r.subject,
            kind: normalizeCampaignKind(r.kind, r.slug),
            createdAt: r.createdAt,
            attempted,
            sent,
            failed,
            skipped,
            pending,
            other: Math.max(0, attempted - sent - failed - skipped - pending),
        };
    });
}

/** Total campaign count, uncapped -- pairs with `listCampaignsOverview`'s limit. */
export async function countCampaigns(): Promise<number> {
    const [row] = await db.select({ n: count() }).from(emailCampaigns);
    return Number(row?.n ?? 0);
}

export interface SuppressionRow {
    email: string;
    reason: string;
    note: string | null;
    createdAt: Date;
}

/** Suppression counts grouped by reason (unsubscribe/bounce/complaint/manual). */
export async function suppressionCountsByReason(): Promise<
    { reason: string; n: number }[]
> {
    const rows = await db
        .select({
            reason: emailSuppressions.reason,
            n: count(),
        })
        .from(emailSuppressions)
        .groupBy(emailSuppressions.reason)
        .orderBy(desc(count()));
    return rows.map((r) => ({ reason: r.reason, n: Number(r.n) }));
}

/** Most recently suppressed addresses, newest first. */
export async function recentSuppressions(
    limit = 50,
): Promise<SuppressionRow[]> {
    return db
        .select({
            email: emailSuppressions.email,
            reason: emailSuppressions.reason,
            note: emailSuppressions.note,
            createdAt: emailSuppressions.createdAt,
        })
        .from(emailSuppressions)
        .orderBy(desc(emailSuppressions.createdAt))
        .limit(limit);
}

export interface NewsletterStats {
    total: number;
    confirmed: number;
    unsubscribed: number;
}

/** Newsletter subscription funnel: total signups, confirmed, unsubscribed. */
export async function newsletterStats(): Promise<NewsletterStats> {
    const [row] = await db
        .select({
            total: count(),
            confirmed: sql<number>`count(*) filter (where ${newsletterSubscriptions.confirmedAt} is not null)::int`,
            unsubscribed: sql<number>`count(*) filter (where ${newsletterSubscriptions.unsubscribedAt} is not null)::int`,
        })
        .from(newsletterSubscriptions);
    return {
        total: Number(row?.total ?? 0),
        confirmed: Number(row?.confirmed ?? 0),
        unsubscribed: Number(row?.unsubscribed ?? 0),
    };
}
