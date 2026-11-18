import {
    claimDueStorageDeletions,
    completeStorageDeletion,
    failStorageDeletion,
} from "@/db/queries/storage-deletions";
import { captureServerException } from "@/lib/posthog-server";
import { deleteStorageObject } from "./delete-object";
import { redactStorageKey } from "./errors";
import type { StorageProvider } from "./types";

const SWEEP_BATCH_SIZE = 20;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 12 * 60 * 60 * 1000;

/** Attempts per queued key before it stops retrying and stays as `failed`. */
export const STORAGE_DELETION_MAX_ATTEMPTS = 10;

/** Delay before retry number `attempts + 1`: exponential from 5 minutes, capped at 12 hours. */
export function storageDeletionRetryDelayMs(attempts: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
}

/** Outcome counts for one sweep. */
export interface StorageDeletionSweepResult {
    deleted: number;
    retrying: number;
    failed: number;
}

/**
 * Retries one batch of queued storage deletes. An object that is already
 * gone counts as deleted. Safe to run from every process at once: each
 * key is claimed in the database before it is touched.
 */
export async function sweepStorageDeletionQueue(
    storage: StorageProvider,
): Promise<StorageDeletionSweepResult> {
    const claimed = await claimDueStorageDeletions({
        limit: SWEEP_BATCH_SIZE,
        leaseMs: CLAIM_LEASE_MS,
    });
    const result: StorageDeletionSweepResult = {
        deleted: 0,
        retrying: 0,
        failed: 0,
    };
    for (const entry of claimed) {
        try {
            await deleteStorageObject(storage, entry.storageKey);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            const outcome = await failStorageDeletion({
                storageKey: entry.storageKey,
                claimToken: entry.claimToken,
                errorMessage: message,
                maxAttempts: STORAGE_DELETION_MAX_ATTEMPTS,
                retryAt: new Date(
                    Date.now() + storageDeletionRetryDelayMs(entry.attempts),
                ),
            });
            if (outcome?.status === "failed") {
                result.failed += 1;
                console.error(
                    `[storage-deletion] giving up on ${entry.storageKey} after ${outcome.attempts} attempt(s):`,
                    error,
                );
                captureServerException(
                    redactStorageKey(error, entry.storageKey),
                    {
                        source: "worker:storage-deletion",
                        attempts: outcome.attempts,
                    },
                );
            } else if (outcome) {
                result.retrying += 1;
                console.warn(
                    `[storage-deletion] delete failed for ${entry.storageKey} (attempt ${outcome.attempts}/${STORAGE_DELETION_MAX_ATTEMPTS}), will retry:`,
                    message,
                );
            }
            continue;
        }
        await completeStorageDeletion({
            storageKey: entry.storageKey,
            claimToken: entry.claimToken,
        });
        result.deleted += 1;
    }
    return result;
}
