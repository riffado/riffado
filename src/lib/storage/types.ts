import type { Readable } from "node:stream";

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
     */
    downloadStream(key: string): Promise<Readable>;
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
    /** Cheap existence check, used to fail fast with a placeholder instead of starting a stream that will error partway through. */
    exists(key: string): Promise<boolean>;
    getSignedUrl(key: string, expiresIn: number): Promise<string>;
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
