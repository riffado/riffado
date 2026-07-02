import { db } from "@/db";
import { emailLog } from "@/db/schema";

/**
 * First-write-wins claim on a once-only per-user email send.
 *
 * Returns `true` when this caller wrote the row (caller proceeds to
 * send). Returns `false` when a prior row already exists for this
 * `(userId, kind)` (caller skips the send -- it already happened).
 *
 * Pattern: for marketing/transactional emails that must NEVER reach
 * the same user twice (welcome, billing-launch broadcast, transition
 * cohort emails, payment-failed nudge). High-volume per-event emails
 * (`new-recording`, etc.) bypass this -- they don't need dedup.
 */
export async function claimEmailSend(input: {
    userId: string;
    kind: string;
}): Promise<boolean> {
    const inserted = await db
        .insert(emailLog)
        .values({ userId: input.userId, kind: input.kind })
        .onConflictDoNothing({
            target: [emailLog.userId, emailLog.kind],
        })
        .returning({ id: emailLog.id });
    return inserted.length > 0;
}
