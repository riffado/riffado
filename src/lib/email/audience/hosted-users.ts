import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Recipient } from "@/lib/email/types";

interface HostedUserAudienceOptions {
    verifiedOnly?: boolean;
    requireMarketingConsent?: boolean;
    pageSize?: number;
}

/** Audience generator: non-suspended Riffado users matching the filters. */
export async function* hostedUserAudience(
    options: HostedUserAudienceOptions = {},
): AsyncGenerator<Recipient, void, void> {
    const verifiedOnly = options.verifiedOnly ?? true;
    const requireMarketingConsent = options.requireMarketingConsent ?? false;
    const pageSize = options.pageSize ?? 500;

    let lastId: string | null = null;

    while (true) {
        const conditions = [isNull(users.suspendedAt)];
        if (verifiedOnly) conditions.push(eq(users.emailVerified, true));
        if (requireMarketingConsent) {
            conditions.push(eq(users.marketingEmailConsent, true));
        }
        if (lastId) conditions.push(gt(users.id, lastId));

        const rows = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                marketingEmailConsent: users.marketingEmailConsent,
            })
            .from(users)
            .where(and(...conditions))
            .orderBy(users.id)
            .limit(pageSize);

        if (rows.length === 0) return;

        for (const row of rows) {
            yield {
                kind: "user",
                id: row.id,
                email: row.email,
                name: row.name,
                marketingConsent: row.marketingEmailConsent,
            };
        }

        const last = rows[rows.length - 1];
        if (!last) return;
        lastId = last.id;
        if (rows.length < pageSize) return;
    }
}
