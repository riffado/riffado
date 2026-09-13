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
 *
 * When `expectedBytes` (typically the recorded filesize) is a positive
 * number, a single destination buffer is preallocated up front and
 * chunks are copied into it directly, so the common case performs no
 * final `Buffer.concat`. `expectedBytes` is only a hint -- it can
 * understate the real object (a stale recorded filesize) -- so any
 * bytes beyond the preallocated buffer overflow into a chunk array and
 * are concatenated on at the end. Omit `expectedBytes` to fall back to
 * the chunk-array + `Buffer.concat` behavior unconditionally.
 */
export async function downloadFileWithLimit(
    storage: StorageProvider,
    key: string,
    maxBytes: number,
    expectedBytes?: number,
): Promise<Buffer> {
    const stream: Readable = await storage.downloadStream(key);

    const dest =
        expectedBytes !== undefined && expectedBytes > 0
            ? Buffer.allocUnsafe(Math.min(expectedBytes, maxBytes))
            : null;
    let offset = 0;
    const overflow: Buffer[] = [];
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
            if (dest) {
                if (offset < dest.length) {
                    const spaceLeft = dest.length - offset;
                    if (chunk.length <= spaceLeft) {
                        chunk.copy(dest, offset);
                        offset += chunk.length;
                    } else {
                        chunk.copy(dest, offset, 0, spaceLeft);
                        offset += spaceLeft;
                        overflow.push(chunk.subarray(spaceLeft));
                    }
                } else {
                    overflow.push(chunk);
                }
            } else {
                chunks.push(chunk);
            }
        });
        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("end", () => {
            if (dest) {
                resolve(
                    overflow.length > 0
                        ? Buffer.concat([dest.subarray(0, offset), ...overflow])
                        : dest.subarray(0, offset),
                );
            } else {
                resolve(Buffer.concat(chunks));
            }
        });
    });
}
