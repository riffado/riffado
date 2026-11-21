import {
    enqueueStorageDeletions,
    type StorageDeletionSource,
} from "@/db/queries/storage-deletions";
import { captureServerException } from "@/lib/posthog-server";
import { isStorageObjectMissingError, redactStorageKey } from "./errors";
import type { StorageProvider } from "./types";

/**
 * Delete `key`, treating an object that is already gone as deleted so
 * retries are idempotent. Rejects for every other failure, including
 * unreachable storage (missing local base directory or bucket).
 */
export async function deleteStorageObject(
    storage: StorageProvider,
    key: string,
): Promise<void> {
    try {
        await storage.deleteFile(key);
    } catch (error) {
        if (isStorageObjectMissingError(error)) return;
        throw error;
    }
}

/**
 * Delete `key` now, or queue it in `storage_deletion_queue` (retried by
 * the export worker) when the delete fails. Never rejects: a failed
 * queue write is logged and reported to error tracking without the key.
 * Only pass keys that no database row references.
 */
export async function deleteStorageObjectOrQueue(
    storage: StorageProvider,
    key: string,
    source: StorageDeletionSource,
): Promise<void> {
    try {
        await deleteStorageObject(storage, key);
    } catch (error) {
        console.warn(
            `[storage] could not delete ${key}, queueing retry:`,
            error instanceof Error ? error.message : String(error),
        );
        await enqueueStorageDeletions([key], source).catch((enqueueError) => {
            console.error(
                `[storage] failed to queue ${key} for deletion:`,
                enqueueError,
            );
            captureServerException(redactStorageKey(enqueueError, key), {
                source: `storage-deletion:${source}`,
            });
        });
    }
}
