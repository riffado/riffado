import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../env";
import type { StorageProvider } from "./types";

/**
 * Local filesystem storage provider
 * Stores files in configured local storage path
 */
export class LocalStorage implements StorageProvider {
    private baseDir: string;

    constructor(baseDir?: string) {
        this.baseDir = resolve(baseDir || env.LOCAL_STORAGE_PATH);
    }

    /**
     * Ensure base directory exists
     */
    private async ensureBaseDir(): Promise<void> {
        try {
            await access(this.baseDir);
        } catch {
            await mkdir(this.baseDir, { recursive: true });
        }
    }

    /**
     * Validate that the key doesn't contain path traversal attacks
     * and get the safe full file path
     */
    private getFilePath(key: string): string {
        const normalizedKey = key.replace(/\\/g, "/");

        if (
            normalizedKey.includes("..") ||
            normalizedKey.startsWith("/") ||
            normalizedKey.includes("\0")
        ) {
            throw new Error("Invalid file key: path traversal detected");
        }

        const fullPath = join(this.baseDir, normalizedKey);
        const resolvedPath = resolve(fullPath);

        const relativePath = relative(this.baseDir, resolvedPath);
        if (
            relativePath.startsWith("..") ||
            resolve(relativePath) === resolvedPath
        ) {
            throw new Error("Invalid file key: path outside storage directory");
        }

        return resolvedPath;
    }

    async uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string,
    ): Promise<string> {
        try {
            await this.ensureBaseDir();
            const filePath = this.getFilePath(key);

            const fileDir = dirname(filePath);
            try {
                await access(fileDir);
            } catch {
                await mkdir(fileDir, { recursive: true });
            }

            void contentType;
            await writeFile(filePath, buffer);
            return key;
        } catch (error) {
            throw new Error(
                `Failed to upload file to local storage: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async downloadFile(key: string): Promise<Buffer> {
        try {
            const filePath = this.getFilePath(key);
            return await readFile(filePath);
        } catch (error) {
            throw new Error(
                `Failed to download file from local storage: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async downloadStream(key: string): Promise<Readable> {
        // Existence check up front so callers get a clean rejection
        // instead of a stream that errors after they've already started
        // piping it (e.g. mid-way through an archive entry).
        const filePath = this.getFilePath(key);
        await access(filePath);
        return createReadStream(filePath);
    }

    async uploadStream(
        key: string,
        stream: Readable,
        contentType: string,
    ): Promise<string> {
        void contentType;
        try {
            await this.ensureBaseDir();
            const filePath = this.getFilePath(key);
            const fileDir = dirname(filePath);
            try {
                await access(fileDir);
            } catch {
                await mkdir(fileDir, { recursive: true });
            }
            await pipeline(stream, createWriteStream(filePath));
            return key;
        } catch (error) {
            throw new Error(
                `Failed to stream upload to local storage: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            await access(this.getFilePath(key));
            return true;
        } catch {
            return false;
        }
    }

    async getSignedUrl(key: string, expiresIn: number): Promise<string> {
        void expiresIn;
        return `/api/recordings/audio/${encodeURIComponent(key)}`;
    }

    async deleteFile(key: string): Promise<void> {
        try {
            const filePath = this.getFilePath(key);
            await unlink(filePath);
        } catch (error) {
            throw new Error(
                `Failed to delete file from local storage: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.ensureBaseDir();
            const testKey = `test-${Date.now()}.txt`;
            const testBuffer = Buffer.from("test");
            await this.uploadFile(testKey, testBuffer, "text/plain");
            await this.deleteFile(testKey);
            return true;
        } catch {
            return false;
        }
    }
}
