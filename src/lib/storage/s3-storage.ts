import { Readable } from "node:stream";
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
import type {
    ByteRange,
    DirectDownloadUrlOptions,
    S3Config,
    StorageProvider,
    UploadStreamOptions,
} from "./types";

const MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;
const MULTIPART_QUEUE_SIZE = 2;
const UPLOAD_PROGRESS_CHUNK_BYTES = 64 * 1024;

function progressReportingBody(
    body: Uint8Array,
    onProgress: () => void,
): Readable {
    let offset = 0;
    return new Readable({
        read() {
            if (offset >= body.byteLength) {
                this.push(null);
                return;
            }
            const end = Math.min(
                offset + UPLOAD_PROGRESS_CHUNK_BYTES,
                body.byteLength,
            );
            const chunk = body.subarray(offset, end);
            offset = end;
            onProgress();
            this.push(chunk);
        },
    });
}

/**
 * S3-compatible storage provider
 * Works with AWS S3, Cloudflare R2, MinIO, etc.
 */
export class S3Storage implements StorageProvider {
    private client: S3Client;
    private bucket: string;
    private uploadProgressListeners = new Map<string, () => void>();

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
        this.client.middlewareStack.add(
            (next) => async (args) => {
                const key = (args.input as { Key?: unknown }).Key;
                const onProgress =
                    typeof key === "string"
                        ? this.uploadProgressListeners.get(key)
                        : undefined;
                const request = args.request as { body?: unknown };
                if (!onProgress || !(request.body instanceof Uint8Array)) {
                    return next(args);
                }
                return next({
                    ...args,
                    request: {
                        ...request,
                        body: progressReportingBody(request.body, onProgress),
                    },
                });
            },
            {
                step: "deserialize",
                priority: "low",
                name: "riffadoUploadProgress",
            },
        );

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
                { cause: error },
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
                { cause: error },
            );
        }
    }

    async downloadStream(key: string, range?: ByteRange): Promise<Readable> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ...(range && { Range: `bytes=${range.start}-${range.end}` }),
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
                { cause: error },
            );
        }
    }

    async uploadStream(
        key: string,
        stream: Readable,
        contentType: string,
        options: UploadStreamOptions = {},
    ): Promise<string> {
        const { onProgress } = options;
        if (onProgress) this.uploadProgressListeners.set(key, onProgress);
        try {
            // lib-storage's Upload handles multipart automatically once the
            // stream crosses the part-size threshold, so archives of any
            // size stream straight through without buffering the whole
            // thing in server memory.
            const upload = new Upload({
                client: this.client,
                partSize: MULTIPART_PART_SIZE_BYTES,
                queueSize: MULTIPART_QUEUE_SIZE,
                params: {
                    Bucket: this.bucket,
                    Key: key,
                    Body: stream,
                    ContentType: contentType,
                },
            });
            if (onProgress) upload.on("httpUploadProgress", onProgress);
            await upload.done();
            return key;
        } catch (error) {
            throw new Error(
                `Failed to stream upload to S3: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        } finally {
            if (onProgress) this.uploadProgressListeners.delete(key);
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return true;
        } catch (error) {
            if ((error as { name?: unknown } | null)?.name === "NoSuchBucket") {
                throw error;
            }
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

    async getObjectSize(key: string): Promise<number> {
        const response = await this.client.send(
            new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        if (typeof response.ContentLength !== "number") {
            throw new Error(
                `S3 HeadObject returned no ContentLength for ${key}`,
            );
        }
        return response.ContentLength;
    }

    async getDirectDownloadUrl(
        key: string,
        options: DirectDownloadUrlOptions,
    ): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ResponseContentType: options.contentType,
        });
        return getSignedUrl(this.client, command, {
            expiresIn: options.expiresInSeconds,
        });
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
                { cause: error },
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
                { cause: error },
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
