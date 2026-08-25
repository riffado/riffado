import {
    type AutoTranscribeRetryOptions,
    listUntranscribedRecordingIds,
} from "@/lib/sync/untranscribed";

const inFlightAutoTranscribeIds = new Set<string>();
const recentFailedAutoTranscribeIds = new Set<string>();

function idsExcludedFromAutoTranscribeRetry(): string[] {
    return [
        ...new Set([
            ...inFlightAutoTranscribeIds,
            ...recentFailedAutoTranscribeIds,
        ]),
    ];
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
 * Failures are excluded from the next newest-first retry window so
 * older recordings still get an attempt. Success clears that exclusion.
 */
export function noteAutoTranscribeOutcome(
    recordingId: string,
    success: boolean,
): void {
    if (success) {
        recentFailedAutoTranscribeIds.delete(recordingId);
        return;
    }
    recentFailedAutoTranscribeIds.add(recordingId);
}

/**
 * Newest-first retry ids, excluding in-flight and recently failed
 * recordings. When that window is empty, recent failures are cleared
 * so the next pass can wrap around.
 */
export async function listAutoTranscribeRetryIds(
    userId: string,
    options: Omit<AutoTranscribeRetryOptions, "excludeIds"> = {},
): Promise<string[]> {
    const ids = await listUntranscribedRecordingIds(userId, {
        ...options,
        excludeIds: idsExcludedFromAutoTranscribeRetry(),
    });
    if (ids.length > 0 || recentFailedAutoTranscribeIds.size === 0) {
        return ids;
    }
    recentFailedAutoTranscribeIds.clear();
    return listUntranscribedRecordingIds(userId, {
        ...options,
        excludeIds: idsExcludedFromAutoTranscribeRetry(),
    });
}

/** Test-only: drop process-local in-flight and failure state. */
export function resetAutoTranscribeStateForTests(): void {
    inFlightAutoTranscribeIds.clear();
    recentFailedAutoTranscribeIds.clear();
}
