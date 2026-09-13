import type { Readable } from "node:stream";
import type { StorageProvider } from "@/lib/storage/types";

/** Thrown by `downloadFileWithLimit` when the stream exceeds `limitBytes`. */
export class DownloadSizeLimitError extends Error {
    constructor(public limitBytes: number) {
        super(`Download exceeded the ${limitBytes} byte limit.`);
        this.name = "DownloadSizeLimitError";
    }
}

/**
 * Downloads `key` from `storage` into a `Buffer`, aborting as soon as the
 * running total exceeds `maxBytes` instead of materializing the whole
 * object first. Used to enforce provider-specific upload caps (e.g.
 * ElevenLabs) without buffering a pathologically large file into memory
 * before the cap is checked.
 */
export async function downloadFileWithLimit(
    storage: StorageProvider,
    key: string,
    maxBytes: number,
): Promise<Buffer> {
    const stream: Readable = await storage.downloadStream(key);
    const chunks: Buffer[] = [];
    let total = 0;

    return new Promise<Buffer>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                stream.destroy();
                reject(new DownloadSizeLimitError(maxBytes));
                return;
            }
            chunks.push(chunk);
        });
        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
    });
}
