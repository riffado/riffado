import type { Readable } from "node:stream";

/** Inclusive byte range for a partial read. */
export interface ByteRange {
    start: number;
    end: number;
}

/** Response overrides for a URL the browser fetches from storage directly. */
export interface DirectDownloadUrlOptions {
    expiresInSeconds: number;
    /** Content-Type the storage backend sends instead of the object's stored metadata. */
    contentType: string;
}

/** Storage provider interface — implemented by local FS and S3-compatible. */
export interface StorageProvider {
    uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string,
    ): Promise<string>;
    downloadFile(key: string): Promise<Buffer>;
    /**
     * Streaming read. Used by the export archive builder so a single
     * recording's audio is never fully buffered in server memory --
     * bytes flow straight from storage into the zip stream. Rejects
     * (or the returned stream emits `error`) if the key doesn't exist.
     * With `range`, only those bytes are read from the backend.
     */
    downloadStream(key: string, range?: ByteRange): Promise<Readable>;
    /** Size of the stored object in bytes. Rejects if the key doesn't exist. */
    getObjectSize(key: string): Promise<number>;
    /**
     * Streaming write. `contentLength` is a hint some backends (S3
     * multipart) can use but must not require -- callers may not know
     * the final size up front (e.g. a zip archive being built live).
     */
    uploadStream(
        key: string,
        stream: Readable,
        contentType: string,
    ): Promise<string>;
    /** Cheap existence check, used to fail fast with a placeholder instead of starting a stream that will error partway through. Resolves false for a missing or rejected key; rejects when the storage itself is unavailable (e.g. a missing base directory or bucket, or unreadable storage). */
    exists(key: string): Promise<boolean>;
    getSignedUrl(key: string, expiresIn: number): Promise<string>;
    /**
     * Short-lived URL on the storage backend itself, so a browser can read
     * the object (including ranged reads) without the bytes passing through
     * the app server. Absent when the backend has no endpoint of its own
     * (local filesystem); callers then stream through the app.
     */
    getDirectDownloadUrl?(
        key: string,
        options: DirectDownloadUrlOptions,
    ): Promise<string>;
    deleteFile(key: string): Promise<void>;
    testConnection(): Promise<boolean>;
}

export interface S3Config {
    /** Optional for non-AWS S3-compatible services. */
    endpoint?: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export type StorageType = "local" | "s3";
