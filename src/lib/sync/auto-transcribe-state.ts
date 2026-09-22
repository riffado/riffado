import {
    AUTO_TRANSCRIBE_RETRY_LIMIT,
    type AutoTranscribeRetryOptions,
    listUntranscribedRecordingIds,
} from "@/lib/sync/untranscribed";
import type { TranscribeFailureKind } from "@/lib/transcription/failure-kind";

/** Max remembered failed ids per user in this process. */
export const AUTO_TRANSCRIBE_FAILED_ID_LIMIT = 256;

/** Transient failures after which auto-transcribe stops retrying a recording. */
export const AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES = 6;

/** Wait before the first transient-failure retry; doubles per failure. */
export const AUTO_TRANSCRIBE_RETRY_BACKOFF_MS = 10 * 60 * 1000;

type FailureState = {
    transientFailures: number;
    retryAt: number;
    stopped: boolean;
};

const inFlightAutoTranscribeIds = new Set<string>();
const recentFailedByUser = new Map<string, Map<string, FailureState>>();

function failedIdsFor(userId: string): Map<string, FailureState> {
    let failed = recentFailedByUser.get(userId);
    if (!failed) {
        failed = new Map();
        recentFailedByUser.set(userId, failed);
    }
    return failed;
}

function excludeIdsForUser(userId: string): string[] {
    const failed = recentFailedByUser.get(userId);
    return [
        ...new Set([...inFlightAutoTranscribeIds, ...(failed?.keys() ?? [])]),
    ];
}

function evictOverflow(
    failed: Map<string, FailureState>,
    keepId: string,
): void {
    while (failed.size > AUTO_TRANSCRIBE_FAILED_ID_LIMIT) {
        let evict: string | undefined;
        for (const [id, state] of failed) {
            if (!state.stopped && id !== keepId) {
                evict = id;
                break;
            }
        }
        evict ??= failed.keys().next().value;
        if (evict === undefined) break;
        failed.delete(evict);
    }
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
 * Record the outcome of an auto-transcribe attempt. Failures are excluded
 * from that user's next newest-first retry window so older recordings
 * still get an attempt. A `permanent` failure, or the
 * `AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES`th `transient` one, stops auto
 * retries for the recording in this process; transient failures before
 * that back off exponentially. A failure without a kind (no provider,
 * lockout, budget) is retried on rotation without counting. Success
 * clears the recording, including a stopped one.
 *
 * @returns `true` when this outcome stopped auto retries for the recording.
 */
export function noteAutoTranscribeOutcome(
    userId: string,
    recordingId: string,
    success: boolean,
    failureKind?: TranscribeFailureKind,
): boolean {
    const failed = failedIdsFor(userId);
    if (success) {
        failed.delete(recordingId);
        if (failed.size === 0) {
            recentFailedByUser.delete(userId);
        }
        return false;
    }
    const previous = failed.get(recordingId);
    const transientFailures =
        (previous?.transientFailures ?? 0) +
        (failureKind === "transient" ? 1 : 0);
    const stopped =
        failureKind === "permanent" ||
        transientFailures >= AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES;
    const retryAt =
        failureKind === "transient" && !stopped
            ? Date.now() +
              AUTO_TRANSCRIBE_RETRY_BACKOFF_MS * 2 ** (transientFailures - 1)
            : 0;
    failed.delete(recordingId);
    failed.set(recordingId, { transientFailures, retryAt, stopped });
    evictOverflow(failed, recordingId);
    return stopped && !previous?.stopped;
}

/**
 * Newest-first retry ids for one user, excluding in-flight and that
 * user's recently failed recordings. Unused slots, or one slot when
 * the newest window is full, are filled from that user's oldest
 * still-eligible failures that are neither stopped nor backing off, so a
 * stream of newer recordings cannot starve retries. Deleted or
 * already-transcribed failures are dropped, stopped ones included.
 */
export async function listAutoTranscribeRetryIds(
    userId: string,
    options: Omit<AutoTranscribeRetryOptions, "excludeIds" | "onlyIds"> = {},
): Promise<string[]> {
    const fresh = await listUntranscribedRecordingIds(userId, {
        ...options,
        excludeIds: excludeIdsForUser(userId),
    });
    const failed = recentFailedByUser.get(userId);
    if (!failed || failed.size === 0) return fresh;

    const candidates: string[] = [];
    for (const id of failed.keys()) {
        if (inFlightAutoTranscribeIds.has(id)) continue;
        candidates.push(id);
    }
    if (candidates.length === 0) return fresh;

    let stillEligible: string[];
    try {
        stillEligible = await listUntranscribedRecordingIds(userId, {
            ...options,
            excludeIds: [...inFlightAutoTranscribeIds],
            onlyIds: candidates,
            limit: candidates.length,
        });
    } catch (error) {
        console.error("Auto-transcribe failure revalidation failed:", error);
        return fresh;
    }

    if (recentFailedByUser.get(userId) !== failed) {
        return fresh;
    }

    const eligible = new Set(stillEligible);
    for (const id of candidates) {
        if (!eligible.has(id)) failed.delete(id);
    }
    if (failed.size === 0) {
        recentFailedByUser.delete(userId);
        return fresh;
    }

    const now = Date.now();
    const retryable = candidates.filter((id) => {
        const state = failed.get(id);
        return state !== undefined && !state.stopped && state.retryAt <= now;
    });
    if (retryable.length === 0) return fresh;

    const reserve =
        fresh.length >= AUTO_TRANSCRIBE_RETRY_LIMIT
            ? 1
            : AUTO_TRANSCRIBE_RETRY_LIMIT - fresh.length;
    const fromFailed = retryable.slice(0, reserve);
    return [
        ...fresh.slice(0, AUTO_TRANSCRIBE_RETRY_LIMIT - fromFailed.length),
        ...fromFailed,
    ];
}

/** Test-only: drop process-local in-flight and failure state. */
export function resetAutoTranscribeStateForTests(): void {
    inFlightAutoTranscribeIds.clear();
    recentFailedByUser.clear();
}
