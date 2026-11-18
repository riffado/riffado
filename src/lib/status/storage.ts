import type { Readable } from "node:stream";
import type { StorageProvider } from "@/lib/storage/types";
import { judgeStorageCall } from "./outcomes";
import {
    type CallOutcome,
    isStatusEnabled,
    type Settled,
    trackCall,
} from "./record";

const judgeKeyCall = judgeStorageCall("key");
const judgeWriteCall = judgeStorageCall("write");
const OUTCOME_ONLY = { latency: false } as const;

function judgeExists(settled: Settled<boolean>): CallOutcome {
    if (settled.ok) return settled.value ? "ok" : "ignore";
    return judgeKeyCall(settled);
}

function judgeOpenStream(settled: Settled<Readable>): CallOutcome {
    return settled.ok ? "ignore" : judgeKeyCall(settled);
}

/**
 * Wrap `provider` so storage calls are recorded for the storage status
 * part. Uploads and downloads count their outcome without latency (their
 * duration follows the payload size); existence checks and deletes count
 * both. An existence check that finds nothing and a stream that opened
 * are not counted (the stream is paced by its consumer), but failures to
 * open one are. Signed URLs (local computation), streamed uploads (paced
 * by the producer) and testConnection (the probe) pass through untracked.
 * Returns `provider` itself when status checks are not configured.
 */
export function withStorageTiming(provider: StorageProvider): StorageProvider {
    if (!isStatusEnabled()) return provider;
    return {
        uploadFile: (key, buffer, contentType) =>
            trackCall(
                "storage",
                () => provider.uploadFile(key, buffer, contentType),
                judgeWriteCall,
                OUTCOME_ONLY,
            ),
        downloadFile: (key) =>
            trackCall(
                "storage",
                () => provider.downloadFile(key),
                judgeKeyCall,
                OUTCOME_ONLY,
            ),
        downloadStream: (key) =>
            trackCall(
                "storage",
                () => provider.downloadStream(key),
                judgeOpenStream,
            ),
        uploadStream: (key, stream, contentType) =>
            provider.uploadStream(key, stream, contentType),
        exists: (key) =>
            trackCall("storage", () => provider.exists(key), judgeExists),
        getSignedUrl: (key, expiresIn) => provider.getSignedUrl(key, expiresIn),
        deleteFile: (key) =>
            trackCall("storage", () => provider.deleteFile(key), judgeKeyCall),
        testConnection: () => provider.testConnection(),
    };
}
