/**
 * Unit tests for `downloadFileWithLimit`: it must abort as soon as the
 * running total crosses the cap instead of buffering the whole stream
 * first, and must return the full buffer when the stream stays under
 * the cap. The destination buffer grows geometrically from observed
 * stream bytes only -- it is never sized from caller-supplied metadata.
 */

import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
    DownloadSizeLimitError,
    downloadFileWithLimit,
} from "@/lib/storage/download-limited";
import type { StorageProvider } from "@/lib/storage/types";

function fakeStorage(stream: Readable): StorageProvider {
    return {
        uploadFile: vi.fn(),
        downloadFile: vi.fn(),
        downloadStream: vi.fn().mockResolvedValue(stream),
        uploadStream: vi.fn(),
        exists: vi.fn(),
        getSignedUrl: vi.fn(),
        deleteFile: vi.fn(),
        testConnection: vi.fn(),
    } as unknown as StorageProvider;
}

describe("downloadFileWithLimit", () => {
    it("returns the full buffer when the stream stays under the cap", async () => {
        const stream = Readable.from([
            Buffer.from("hello "),
            Buffer.from("world"),
        ]);
        const storage = fakeStorage(stream);

        const result = await downloadFileWithLimit(storage, "key", 1024);

        expect(result.toString()).toBe("hello world");
    });

    it("throws DownloadSizeLimitError and stops reading once the cap is exceeded", async () => {
        const chunk = Buffer.alloc(10, "a");
        // A large number of chunks -- if the guard didn't stop early, this
        // would keep accumulating well past the cap.
        const chunks = Array.from({ length: 1000 }, () => chunk);
        const stream = Readable.from(chunks);
        const destroySpy = vi.spyOn(stream, "destroy");
        const storage = fakeStorage(stream);

        await expect(
            downloadFileWithLimit(storage, "key", 25),
        ).rejects.toBeInstanceOf(DownloadSizeLimitError);
        expect(destroySpy).toHaveBeenCalled();
    });

    it("carries the limit on the thrown error", async () => {
        const stream = Readable.from([Buffer.alloc(50, "a")]);
        const storage = fakeStorage(stream);

        const error = await downloadFileWithLimit(storage, "key", 10).catch(
            (err) => err,
        );

        expect(error).toBeInstanceOf(DownloadSizeLimitError);
        expect((error as DownloadSizeLimitError).limitBytes).toBe(10);
    });

    it("propagates a stream error", async () => {
        const stream = new Readable({
            read() {
                this.emit("error", new Error("boom"));
            },
        });
        const storage = fakeStorage(stream);

        await expect(
            downloadFileWithLimit(storage, "key", 1024),
        ).rejects.toThrow(/boom/);
    });

    describe("buffer growth", () => {
        it("returns byte-exact output for a large payload delivered in many small chunks that force several growth steps", async () => {
            const source = Buffer.from(
                Array.from({ length: 300_000 }, (_, i) => i % 256),
            );
            const chunkSize = 37;
            const chunks: Buffer[] = [];
            for (let i = 0; i < source.length; i += chunkSize) {
                chunks.push(source.subarray(i, i + chunkSize));
            }
            const stream = Readable.from(chunks);
            const storage = fakeStorage(stream);

            const result = await downloadFileWithLimit(
                storage,
                "key",
                10 * 1024 * 1024,
            );

            expect(result.length).toBe(source.length);
            expect(result.equals(source)).toBe(true);
        });

        it("handles a single chunk larger than the initial capacity", async () => {
            const source = Buffer.alloc(200 * 1024, "z");
            const stream = Readable.from([source]);
            const storage = fakeStorage(stream);

            const result = await downloadFileWithLimit(
                storage,
                "key",
                1024 * 1024,
            );

            expect(result.equals(source)).toBe(true);
        });

        it("returns an empty buffer for an empty stream", async () => {
            const stream = Readable.from([]);
            const storage = fakeStorage(stream);

            const result = await downloadFileWithLimit(storage, "key", 1024);

            expect(result.length).toBe(0);
        });

        it("succeeds when the payload lands exactly on maxBytes", async () => {
            const source = Buffer.alloc(100, "x");
            const stream = Readable.from([source]);
            const storage = fakeStorage(stream);

            const result = await downloadFileWithLimit(storage, "key", 100);

            expect(result.equals(source)).toBe(true);
        });

        it("rejects when the payload is one byte over maxBytes", async () => {
            const source = Buffer.alloc(101, "x");
            const stream = Readable.from([source]);
            const storage = fakeStorage(stream);

            await expect(
                downloadFileWithLimit(storage, "key", 100),
            ).rejects.toBeInstanceOf(DownloadSizeLimitError);
        });
    });
});
