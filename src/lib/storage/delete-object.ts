import { isStorageObjectMissingError } from "./errors";
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
