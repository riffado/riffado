import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailCampaigns } from "@/db/schema";

export type CampaignKind = "transactional" | "announcement" | "marketing";

const CAMPAIGN_KINDS: readonly CampaignKind[] = [
    "transactional",
    "announcement",
    "marketing",
];

/**
 * `email_campaigns.kind` is a plain `varchar(20)`, not a DB enum/check
 * constraint -- the column doesn't itself guarantee only these three
 * values ever land there. `kind` drives `resolveFromAddress()` (picks
 * the transactional vs. marketing From: header), so trusting an
 * unrecognized value via a blind cast could send from the wrong
 * address. Fall back to "marketing" (the most conservative choice --
 * strictest opt-out/unsubscribe handling) rather than propagate junk.
 */
function normalizeCampaignKind(value: string, slug: string): CampaignKind {
    if ((CAMPAIGN_KINDS as readonly string[]).includes(value)) {
        return value as CampaignKind;
    }
    console.error(
        `[email-campaigns] campaign ${slug} has unexpected kind "${value}"; treating as "marketing"`,
    );
    return "marketing";
}

export interface CampaignRow {
    id: string;
    slug: string;
    subject: string;
    kind: CampaignKind;
    createdAt: Date;
}

export async function getCampaignBySlug(
    slug: string,
): Promise<CampaignRow | null> {
    const rows = await db
        .select()
        .from(emailCampaigns)
        .where(eq(emailCampaigns.slug, slug))
        .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        subject: row.subject,
        kind: normalizeCampaignKind(row.kind, row.slug),
        createdAt: row.createdAt,
    };
}

/** Find-or-create a campaign by slug. First-write wins on subject/kind. */
export async function ensureCampaign(input: {
    slug: string;
    subject: string;
    kind: CampaignKind;
}): Promise<CampaignRow> {
    const existing = await getCampaignBySlug(input.slug);
    if (existing) return existing;

    const inserted = await db
        .insert(emailCampaigns)
        .values({
            slug: input.slug,
            subject: input.subject,
            kind: input.kind,
        })
        .onConflictDoNothing({ target: emailCampaigns.slug })
        .returning();

    if (inserted[0]) {
        return {
            id: inserted[0].id,
            slug: inserted[0].slug,
            subject: inserted[0].subject,
            kind: normalizeCampaignKind(inserted[0].kind, inserted[0].slug),
            createdAt: inserted[0].createdAt,
        };
    }

    const reread = await getCampaignBySlug(input.slug);
    if (!reread) {
        throw new Error(
            `ensureCampaign: insert returned no row and slug ${input.slug} not found after race`,
        );
    }
    return reread;
}
