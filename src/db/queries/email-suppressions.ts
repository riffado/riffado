import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";

export type SuppressionReason =
    | "unsubscribe"
    | "bounce"
    | "complaint"
    | "manual";

/** Idempotent suppression. Re-suppress updates reason/note; createdAt preserved. */
export async function suppressEmail(
    email: string,
    reason: SuppressionReason,
    note?: string,
): Promise<void> {
    const normalized = email.toLowerCase();
    await db
        .insert(emailSuppressions)
        .values({
            email: normalized,
            reason,
            note: note ?? null,
        })
        .onConflictDoUpdate({
            target: emailSuppressions.email,
            set: {
                reason,
                note: note ?? null,
            },
        });
}

/** Returns the subset of `emails` that are suppressed. */
export async function findSuppressedEmails(
    emails: readonly string[],
): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const normalized = emails.map((e) => e.toLowerCase());
    const rows = await db
        .select({ email: emailSuppressions.email })
        .from(emailSuppressions)
        .where(inArray(emailSuppressions.email, normalized));
    return new Set(rows.map((r) => r.email));
}

/**
 * Returns the subset of `emails` suppressed because the mail server rejected
 * them permanently. Unsubscribes and complaints only stop campaign mail.
 */
export async function findBouncedEmails(
    emails: readonly string[],
): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const normalized = emails.map((e) => e.toLowerCase());
    const rows = await db
        .select({ email: emailSuppressions.email })
        .from(emailSuppressions)
        .where(
            and(
                inArray(emailSuppressions.email, normalized),
                eq(emailSuppressions.reason, "bounce"),
            ),
        );
    return new Set(rows.map((r) => r.email));
}

/** Removes a bounce suppression for `email`; other reasons are kept. */
export async function clearBouncedEmail(email: string): Promise<void> {
    await db
        .delete(emailSuppressions)
        .where(
            and(
                eq(emailSuppressions.email, email.toLowerCase()),
                eq(emailSuppressions.reason, "bounce"),
            ),
        );
}

export async function isSuppressed(email: string): Promise<boolean> {
    const set = await findSuppressedEmails([email]);
    return set.has(email.toLowerCase());
}
