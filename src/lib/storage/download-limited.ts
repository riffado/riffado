import type { Readable } from "node:stream";
import type { StorageProvider } from "@/lib/storage/types";

/** Thrown by `downloadFileWithLimit` when the stream exceeds `limitBytes`. */
export class DownloadSizeLimitError extends Error {
    constructor(public limitBytes: number) {
        super(`Download exceeded the ${limitBytes} byte limit.`);
        this.name = "DownloadSizeLimitError";
    }
}

const INITIAL_CAPACITY_BYTES = 64 * 1024;

/**
 * Downloads `key` from `storage` into a `Buffer`, aborting as soon as the
 * running total exceeds `maxBytes` instead of materializing the whole
 * object first. Used to enforce provider-specific upload caps (e.g.
 * ElevenLabs) without buffering a pathologically large file into memory
 * before the cap is checked.
 *
 * The destination buffer is sized only from bytes actually observed on the
 * stream, never from caller-supplied metadata: it starts unallocated, grows
 * geometrically (doubling) as chunks arrive, and is clamped so its capacity
 * never exceeds `maxBytes`. There is no final `Buffer.concat` of the whole
 * payload on any path.
 */
export async function downloadFileWithLimit(
    storage: StorageProvider,
    key: string,
    maxBytes: number,
): Promise<Buffer> {
    const stream: Readable = await storage.downloadStream(key);

    let dest: Buffer | null = null;
    let offset = 0;
    let total = 0;

    function ensureCapacity(required: number): Buffer {
        if (dest === null) {
            const initial = Math.min(
                Math.max(INITIAL_CAPACITY_BYTES, required),
                maxBytes,
            );
            dest = Buffer.allocUnsafe(initial);
            return dest;
        }
        if (required <= dest.length) {
            return dest;
        }
        let nextCapacity = dest.length;
        while (nextCapacity < required) {
            nextCapacity = Math.min(nextCapacity * 2, maxBytes);
        }
        const grown = Buffer.allocUnsafe(nextCapacity);
        dest.copy(grown, 0, 0, offset);
        dest = grown;
        return dest;
    }

    return new Promise<Buffer>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                stream.destroy();
                reject(new DownloadSizeLimitError(maxBytes));
                return;
            }
            const buffer = ensureCapacity(offset + chunk.length);
            chunk.copy(buffer, offset);
            offset += chunk.length;
        });
        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("end", () => {
            resolve(dest === null ? Buffer.alloc(0) : dest.subarray(0, offset));
        });
    });
}
