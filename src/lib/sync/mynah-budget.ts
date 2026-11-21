import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { getUserBillingState } from "@/db/queries/billing";
import { recordings } from "@/db/schema";
import { env } from "@/lib/env";
import { closeCycleForUser } from "@/lib/hosted/billing/cycle-close";
import { mynahSecondsForDuration } from "@/lib/hosted/transcription/mynah";
import { transcriptionRunsOnMynah } from "@/lib/transcription/effective-provider";

/**
 * Durations in milliseconds for the user's live recordings among `ids`.
 * Ids that are missing or deleted are absent from the result.
 */
export async function loadRecordingDurationsMs(
    userId: string,
    ids: readonly string[],
): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: recordings.id, duration: recordings.duration })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, userId),
                inArray(recordings.id, [...ids]),
                isNull(recordings.deletedAt),
            ),
        );
    return new Map(rows.map((row) => [row.id, row.duration]));
}

/**
 * Drop ids that cannot fit in the user's remaining Mynah budget, so a used-up
 * budget does not claim recordings on every sync tick. Applies the due cycle
 * reset first, under the same conditions as the billing worker (billing
 * enabled, a plan, a due or unset reset time), so a user whose cycle just
 * rolled over is not filtered on the old counter. Returns `ids` untouched when the user's transcription does not
 * run on Mynah, and fails open (returns `ids`) when the budget cannot be read.
 */
export async function filterIdsWithinMynahBudget(input: {
    userId: string;
    providerPointer: string | null;
    ids: readonly string[];
}): Promise<string[]> {
    const { userId, providerPointer, ids } = input;
    if (ids.length === 0) return [];
    try {
        if (!(await transcriptionRunsOnMynah(userId, providerPointer))) {
            return [...ids];
        }
        let state = await getUserBillingState(userId);
        if (!state) return [...ids];
        const resetAt = state.monthlyMynahGrantResetAt;
        const resetDue = resetAt === null || resetAt.getTime() <= Date.now();
        if (
            env.BILLING_ENABLED &&
            state.plan !== null &&
            resetDue &&
            (await closeCycleForUser(userId))
        ) {
            state = await getUserBillingState(userId);
            if (!state) return [...ids];
        }
        const remainingSeconds = state.monthlyMynahSecondsRemaining;
        const durations = await loadRecordingDurationsMs(userId, ids);
        return ids.filter((id) => {
            const durationMs = durations.get(id);
            return (
                durationMs === undefined ||
                mynahSecondsForDuration(durationMs) <= remainingSeconds
            );
        });
    } catch (error) {
        console.error("Mynah budget pre-check failed:", error);
        return [...ids];
    }
}
