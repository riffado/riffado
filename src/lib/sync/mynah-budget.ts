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
 * The user's remaining Mynah seconds, or null when the budget does not apply
 * or cannot be read. Applies the due cycle reset first, under the same
 * conditions as the billing worker (billing enabled, a plan, a due or unset
 * reset time), so a user whose cycle just rolled over is not measured on the
 * old counter. The billing state is re-read after every reset attempt, since
 * a concurrent worker may have done the reset. Null when the user's
 * transcription does not run on Mynah; fails open (null) on any error.
 */
export async function getRemainingMynahSeconds(input: {
    userId: string;
    providerPointer: string | null;
}): Promise<number | null> {
    const { userId, providerPointer } = input;
    try {
        if (!(await transcriptionRunsOnMynah(userId, providerPointer))) {
            return null;
        }
        let state = await getUserBillingState(userId);
        if (!state) return null;
        const resetAt = state.monthlyMynahGrantResetAt;
        const resetDue = resetAt === null || resetAt.getTime() <= Date.now();
        if (env.BILLING_ENABLED && state.plan !== null && resetDue) {
            await closeCycleForUser(userId);
            state = await getUserBillingState(userId);
            if (!state) return null;
        }
        return state.monthlyMynahSecondsRemaining;
    } catch (error) {
        console.error("Mynah budget pre-check failed:", error);
        return null;
    }
}

/**
 * Longest recording duration in milliseconds that fits `remainingSeconds`,
 * matching the reservation rounding in `mynahSecondsForDuration`. Returns
 * undefined for null (no limit) and -1 when nothing fits.
 */
export function maxDurationMsForMynahSeconds(
    remainingSeconds: number | null,
): number | undefined {
    if (remainingSeconds === null) return undefined;
    const seconds = Math.floor(remainingSeconds);
    return seconds < 1 ? -1 : seconds * 1000;
}

/**
 * Drop ids that cannot fit in `remainingSeconds`, so a used-up budget does
 * not claim recordings on every sync tick. Returns `ids` untouched when
 * `remainingSeconds` is null, and fails open (returns `ids`) when the
 * durations cannot be read.
 */
export async function filterIdsWithinMynahBudget(input: {
    userId: string;
    remainingSeconds: number | null;
    ids: readonly string[];
}): Promise<string[]> {
    const { userId, remainingSeconds, ids } = input;
    if (ids.length === 0) return [];
    if (remainingSeconds === null) return [...ids];
    try {
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
