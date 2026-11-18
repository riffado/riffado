import type { StorageProvider } from "@/lib/storage/types";
import { judgeStorageCall } from "./outcomes";
import { isStatusEnabled, trackCall } from "./record";

/**
 * Wrap `provider` so uploads, downloads, deletes and existence checks are
 * recorded for the storage status part. Signed URLs (local computation),
 * streamed uploads (paced by the producer) and testConnection (the probe)
 * pass through untimed. Returns `provider` itself when status checks are
 * not configured.
 */
export function withStorageTiming(provider: StorageProvider): StorageProvider {
    if (!isStatusEnabled()) return provider;
    return {
        uploadFile: (key, buffer, contentType) =>
            trackCall(
                "storage",
                () => provider.uploadFile(key, buffer, contentType),
                judgeStorageCall,
            ),
        downloadFile: (key) =>
            trackCall(
                "storage",
                () => provider.downloadFile(key),
                judgeStorageCall,
            ),
        downloadStream: (key) =>
            trackCall(
                "storage",
                () => provider.downloadStream(key),
                judgeStorageCall,
            ),
        uploadStream: (key, stream, contentType) =>
            provider.uploadStream(key, stream, contentType),
        exists: (key) =>
            trackCall("storage", () => provider.exists(key), judgeStorageCall),
        getSignedUrl: (key, expiresIn) => provider.getSignedUrl(key, expiresIn),
        deleteFile: (key) =>
            trackCall(
                "storage",
                () => provider.deleteFile(key),
                judgeStorageCall,
            ),
        testConnection: () => provider.testConnection(),
    };
}
