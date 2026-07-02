import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { newsletterSubscriptions } from "@/db/schema";

export type SubscriptionSource = "landing" | "install" | "admin";

export interface SubscriberRow {
    id: string;
    email: string;
    source: SubscriptionSource;
    consentedAt: Date;
    confirmedAt: Date | null;
    unsubscribedAt: Date | null;
}

/** Idempotent upsert. Re-signup re-stamps consent + clears unsubscribed_at; never auto-confirms. */
export async function upsertSubscriber(input: {
    email: string;
    source: SubscriptionSource;
}): Promise<SubscriberRow> {
    const email = input.email.trim().toLowerCase();
    const now = new Date();

    const result = await db
        .insert(newsletterSubscriptions)
        .values({
            email,
            source: input.source,
            consentedAt: now,
        })
        .onConflictDoUpdate({
            target: newsletterSubscriptions.email,
            set: {
                consentedAt: now,
                unsubscribedAt: null,
                source: input.source,
                updatedAt: now,
            },
        })
        .returning();

    const row = result[0];
    if (!row) {
        throw new Error("upsertSubscriber: insert/upsert returned no row");
    }
    return mapRow(row);
}

export async function getSubscriberById(
    id: string,
): Promise<SubscriberRow | null> {
    const rows = await db
        .select()
        .from(newsletterSubscriptions)
        .where(eq(newsletterSubscriptions.id, id))
        .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
}

export async function getSubscriberByEmail(
    email: string,
): Promise<SubscriberRow | null> {
    const rows = await db
        .select()
        .from(newsletterSubscriptions)
        .where(eq(newsletterSubscriptions.email, email.toLowerCase()))
        .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
}

/** Mark confirmed. No-op if already confirmed. Returns false if row missing. */
export async function confirmSubscriber(id: string): Promise<boolean> {
    const existing = await getSubscriberById(id);
    if (!existing) return false;
    if (existing.confirmedAt) return true;

    await db
        .update(newsletterSubscriptions)
        .set({
            confirmedAt: new Date(),
            unsubscribedAt: null,
            updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriptions.id, id));
    return true;
}

export async function unsubscribeSubscriber(id: string): Promise<void> {
    await db
        .update(newsletterSubscriptions)
        .set({
            unsubscribedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriptions.id, id));
}

/** Yields confirmed, not-unsubscribed subscribers in id order. */
export async function* iterateConfirmedSubscribers(
    pageSize = 500,
): AsyncGenerator<SubscriberRow, void, void> {
    let lastId: string | null = null;
    while (true) {
        const rows: (typeof newsletterSubscriptions.$inferSelect)[] = lastId
            ? await db
                  .select()
                  .from(newsletterSubscriptions)
                  .where(
                      and(
                          isNotNull(newsletterSubscriptions.confirmedAt),
                          isNull(newsletterSubscriptions.unsubscribedAt),
                          gt(newsletterSubscriptions.id, lastId),
                      ),
                  )
                  .orderBy(newsletterSubscriptions.id)
                  .limit(pageSize)
            : await db
                  .select()
                  .from(newsletterSubscriptions)
                  .where(
                      and(
                          isNotNull(newsletterSubscriptions.confirmedAt),
                          isNull(newsletterSubscriptions.unsubscribedAt),
                      ),
                  )
                  .orderBy(newsletterSubscriptions.id)
                  .limit(pageSize);

        if (rows.length === 0) return;
        for (const row of rows) {
            yield mapRow(row);
        }
        const last = rows[rows.length - 1];
        if (!last) return;
        lastId = last.id;
        if (rows.length < pageSize) return;
    }
}

function mapRow(
    row: typeof newsletterSubscriptions.$inferSelect,
): SubscriberRow {
    return {
        id: row.id,
        email: row.email,
        source: row.source as SubscriptionSource,
        consentedAt: row.consentedAt,
        confirmedAt: row.confirmedAt,
        unsubscribedAt: row.unsubscribedAt,
    };
}
