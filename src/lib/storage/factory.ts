import { env } from "../env";
import { LocalStorage } from "./local-storage";
import { S3Storage } from "./s3-storage";
import type { S3Config, StorageProvider } from "./types";

/** Build the instance-level storage provider from env. */
export function createStorageProvider(): StorageProvider {
    const storageType = env.DEFAULT_STORAGE_TYPE;

    if (storageType === "local") {
        return new LocalStorage();
    }

    if (storageType === "s3") {
        const s3Config: S3Config = {
            endpoint: env.S3_ENDPOINT,
            bucket: env.S3_BUCKET || "",
            region: env.S3_REGION || "",
            accessKeyId: env.S3_ACCESS_KEY_ID || "",
            secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        };

        if (
            !s3Config.bucket ||
            !s3Config.region ||
            !s3Config.accessKeyId ||
            !s3Config.secretAccessKey
        ) {
            throw new Error(
                "S3 storage is configured but required environment variables are missing (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)",
            );
        }

        return new S3Storage(s3Config);
    }

    throw new Error(`Unsupported storage type: ${storageType}`);
}

export async function createUserStorageProvider(
    _userId: string,
): Promise<StorageProvider> {
    return createStorageProvider();
}

export { LocalStorage } from "./local-storage";
export { S3Storage } from "./s3-storage";
export * from "./types";
