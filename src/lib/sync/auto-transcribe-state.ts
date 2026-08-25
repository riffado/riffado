import {
    type AutoTranscribeRetryOptions,
    listUntranscribedRecordingIds,
} from "@/lib/sync/untranscribed";

/** Max remembered failed ids per user in this process. */
export const AUTO_TRANSCRIBE_FAILED_ID_LIMIT = 256;

const inFlightAutoTranscribeIds = new Set<string>();
const recentFailedByUser = new Map<string, Set<string>>();

function failedIdsFor(userId: string): Set<string> {
    let failed = recentFailedByUser.get(userId);
    if (!failed) {
        failed = new Set();
        recentFailedByUser.set(userId, failed);
    }
    return failed;
}

function excludeIdsForUser(userId: string): string[] {
    const failed = recentFailedByUser.get(userId);
    return [...new Set([...inFlightAutoTranscribeIds, ...(failed ?? [])])];
}

/**
 * Claim ids for a process-local auto-transcribe pass. Already in-flight
 * ids are skipped so overlapping syncs do not double-call the provider.
 */
export function claimAutoTranscribeIds(ids: readonly string[]): string[] {
    const claimed: string[] = [];
    for (const id of ids) {
        if (inFlightAutoTranscribeIds.has(id)) continue;
        inFlightAutoTranscribeIds.add(id);
        claimed.push(id);
    }
    return claimed;
}

/** Release in-flight claims after the provider pass finishes. */
export function releaseAutoTranscribeIds(ids: readonly string[]): void {
    for (const id of ids) {
        inFlightAutoTranscribeIds.delete(id);
    }
}

/**
 * Record whether an auto-transcribe attempt produced a transcript.
 * Failures are excluded from that user's next newest-first retry window
 * so older recordings still get an attempt. Success clears that exclusion.
 */
export function noteAutoTranscribeOutcome(
    userId: string,
    recordingId: string,
    success: boolean,
): void {
    const failed = failedIdsFor(userId);
    if (success) {
        failed.delete(recordingId);
        if (failed.size === 0) {
            recentFailedByUser.delete(userId);
        }
        return;
    }
    failed.delete(recordingId);
    failed.add(recordingId);
    while (failed.size > AUTO_TRANSCRIBE_FAILED_ID_LIMIT) {
        const oldest = failed.values().next().value;
        if (oldest === undefined) break;
        failed.delete(oldest);
    }
}

/**
 * Newest-first retry ids for one user, excluding in-flight and that
 * user's recently failed recordings. When that window is empty, only
 * that user's failures are cleared so the next pass can wrap around.
 */
export async function listAutoTranscribeRetryIds(
    userId: string,
    options: Omit<AutoTranscribeRetryOptions, "excludeIds"> = {},
): Promise<string[]> {
    const ids = await listUntranscribedRecordingIds(userId, {
        ...options,
        excludeIds: excludeIdsForUser(userId),
    });
    const failed = recentFailedByUser.get(userId);
    if (ids.length > 0 || !failed || failed.size === 0) {
        return ids;
    }
    recentFailedByUser.delete(userId);
    return listUntranscribedRecordingIds(userId, {
        ...options,
        excludeIds: excludeIdsForUser(userId),
    });
}

/** Test-only: drop process-local in-flight and failure state. */
export function resetAutoTranscribeStateForTests(): void {
    inFlightAutoTranscribeIds.clear();
    recentFailedByUser.clear();
}
