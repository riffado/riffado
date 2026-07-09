import type { Readable } from "node:stream";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Config, StorageProvider } from "./types";

/**
 * S3-compatible storage provider
 * Works with AWS S3, Cloudflare R2, MinIO, etc.
 */
export class S3Storage implements StorageProvider {
    private client: S3Client;
    private bucket: string;

    constructor(config: S3Config) {
        this.client = new S3Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            ...(config.endpoint && {
                endpoint: config.endpoint,
                forcePathStyle: true, // Required for some S3-compatible services
            }),
        });

        this.bucket = config.bucket;
    }

    async uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string,
    ): Promise<string> {
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            });

            await this.client.send(command);
            return key;
        } catch (error) {
            throw new Error(
                `Failed to upload file to S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async downloadFile(key: string): Promise<Buffer> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            const response = await this.client.send(command);

            if (!response.Body) {
                throw new Error("Empty response body");
            }

            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        } catch (error) {
            throw new Error(
                `Failed to download file from S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async downloadStream(key: string): Promise<Readable> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });
            const response = await this.client.send(command);
            if (!response.Body) {
                throw new Error("Empty response body");
            }
            // Node runtime: Body is a Readable (not a web ReadableStream or Blob).
            return response.Body as Readable;
        } catch (error) {
            throw new Error(
                `Failed to stream download from S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async uploadStream(
        key: string,
        stream: Readable,
        contentType: string,
    ): Promise<string> {
        try {
            // lib-storage's Upload handles multipart automatically once the
            // stream crosses the part-size threshold, so archives of any
            // size stream straight through without buffering the whole
            // thing in server memory.
            const upload = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucket,
                    Key: key,
                    Body: stream,
                    ContentType: contentType,
                },
            });
            await upload.done();
            return key;
        } catch (error) {
            throw new Error(
                `Failed to stream upload to S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return true;
        } catch (error) {
            if (error instanceof NotFound) return false;
            // Some S3-compatible services return a generic 404 error that
            // isn't typed as NotFound -- treat any "not found"-shaped error
            // as missing rather than surfacing a hard failure here, since
            // this check exists purely to decide whether to skip a file.
            const status = (
                error as { $metadata?: { httpStatusCode?: number } }
            )?.$metadata?.httpStatusCode;
            if (status === 404) return false;
            throw error;
        }
    }

    async getSignedUrl(key: string, expiresIn: number): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            return await getSignedUrl(this.client, command, { expiresIn });
        } catch (error) {
            throw new Error(
                `Failed to generate signed URL: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteFile(key: string): Promise<void> {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            await this.client.send(command);
        } catch (error) {
            throw new Error(
                `Failed to delete file from S3: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const command = new HeadBucketCommand({
                Bucket: this.bucket,
            });

            await this.client.send(command);
            return true;
        } catch {
            return false;
        }
    }
}
