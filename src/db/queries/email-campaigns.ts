import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailCampaigns } from "@/db/schema";

export type CampaignKind = "transactional" | "announcement" | "marketing";

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
        kind: row.kind as CampaignKind,
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
            kind: inserted[0].kind as CampaignKind,
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
