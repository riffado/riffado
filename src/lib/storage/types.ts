/** Storage provider interface — implemented by local FS and S3-compatible. */
export interface StorageProvider {
    uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string,
    ): Promise<string>;
    downloadFile(key: string): Promise<Buffer>;
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
