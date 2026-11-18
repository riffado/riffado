/**
 * Storage provider capabilities behind the storage cleanup work:
 *   - ranged reads and object size on both providers, so the audio route
 *     can stream a Range instead of buffering the whole object;
 *   - a presigned storage URL with a Content-Type override on S3 only
 *     (local storage has no endpoint of its own);
 *   - a 32 MiB multipart part size for archive uploads, down from the
 *     SDK's 5 MiB default (about 6x fewer UploadPart requests, and a
 *     ~312 GiB archive ceiling at S3's 10,000-part limit instead of
 *     ~48 GiB), with memory held to queueSize x partSize.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadOptions } = vi.hoisted(() => ({
    uploadOptions: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/env", () => ({ env: { LOCAL_STORAGE_PATH: "/tmp/unused" } }));
vi.mock("@aws-sdk/lib-storage", () => ({
    Upload: class {
        constructor(options: Record<string, unknown>) {
            uploadOptions.push(options);
        }
        async done() {
            return {};
        }
    },
}));

import { setStatusRecordingEnabled } from "@/lib/status/record";
import { withStorageTiming } from "@/lib/status/storage";
import { isStorageObjectMissingError } from "@/lib/storage/errors";
import { LocalStorage } from "@/lib/storage/local-storage";
import { S3Storage } from "@/lib/storage/s3-storage";
import type { StorageProvider } from "@/lib/storage/types";

async function readAll(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString();
}

function s3(): S3Storage {
    return new S3Storage({
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "riffado",
        region: "auto",
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "secret",
    });
}

type SendSpy = { send: (command: { input: unknown }) => Promise<unknown> };

describe("LocalStorage ranged reads", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "riffado-storage-range-"));
        await writeFile(join(dir, "a.ogg"), "0123456789");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("reads only the requested inclusive range", async () => {
        const storage = new LocalStorage(dir);
        expect(
            await readAll(
                await storage.downloadStream("a.ogg", { start: 2, end: 5 }),
            ),
        ).toBe("2345");
        expect(await readAll(await storage.downloadStream("a.ogg"))).toBe(
            "0123456789",
        );
    });

    it("reports the object size, and rejects for a missing key as missing", async () => {
        const storage = new LocalStorage(dir);
        expect(await storage.getObjectSize("a.ogg")).toBe(10);
        const error = await storage
            .getObjectSize("missing.ogg")
            .catch((e: unknown) => e);
        expect(isStorageObjectMissingError(error)).toBe(true);
    });

    it("has no direct storage URL, so callers stream through the app", () => {
        const storage: StorageProvider = new LocalStorage(dir);
        expect(storage.getDirectDownloadUrl).toBeUndefined();
    });
});

describe("isStorageObjectMissingError", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "riffado-storage-missing-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("treats a missing local file as missing but a missing base directory as a failure", async () => {
        const present = new LocalStorage(dir);
        const missingFile = await present
            .deleteFile("nope.ogg")
            .catch((e: unknown) => e);
        expect(isStorageObjectMissingError(missingFile)).toBe(true);

        const unmounted = new LocalStorage(join(dir, "unmounted"));
        const missingRoot = await unmounted
            .deleteFile("nope.ogg")
            .catch((e: unknown) => e);
        expect(isStorageObjectMissingError(missingRoot)).toBe(false);
    });

    it("recognizes S3 not-found shapes and rejects other errors", () => {
        expect(
            isStorageObjectMissingError(
                new Error("wrapped", {
                    cause: { name: "NoSuchKey", $metadata: {} },
                }),
            ),
        ).toBe(true);
        expect(
            isStorageObjectMissingError({
                $metadata: { httpStatusCode: 404 },
            }),
        ).toBe(true);
        expect(
            isStorageObjectMissingError({
                name: "NoSuchBucket",
                $metadata: { httpStatusCode: 404 },
            }),
        ).toBe(false);
        expect(isStorageObjectMissingError(new Error("S3 503"))).toBe(false);
    });
});

describe("S3Storage", () => {
    beforeEach(() => {
        uploadOptions.length = 0;
    });

    it("presigns a direct GET URL with a Content-Type override and the requested lifetime", async () => {
        const url = new URL(
            await s3().getDirectDownloadUrl("user-1/a.mp3", {
                expiresInSeconds: 3600,
                contentType: "audio/ogg",
            }),
        );

        expect(url.pathname).toBe("/riffado/user-1/a.mp3");
        expect(url.searchParams.get("response-content-type")).toBe("audio/ogg");
        expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    });

    it("sends Range to GetObject for a ranged read", async () => {
        const storage = s3();
        const inputs: unknown[] = [];
        const client = (storage as unknown as { client: SendSpy }).client;
        client.send = async (command) => {
            inputs.push(command.input);
            return { Body: Readable.from(["2345"]) };
        };

        await storage.downloadStream("k", { start: 2, end: 5 });

        expect(inputs).toEqual([
            { Bucket: "riffado", Key: "k", Range: "bytes=2-5" },
        ]);
    });

    it("reads the object size from HeadObject", async () => {
        const storage = s3();
        const client = (storage as unknown as { client: SendSpy }).client;
        client.send = async () => ({ ContentLength: 1234 });

        expect(await storage.getObjectSize("k")).toBe(1234);
    });

    it("uploads archives in 32 MiB parts with at most two in flight", async () => {
        await s3().uploadStream(
            "exports/u/job.zip",
            Readable.from(["zip"]),
            "application/zip",
        );

        expect(uploadOptions).toHaveLength(1);
        expect(uploadOptions[0]).toMatchObject({
            partSize: 32 * 1024 * 1024,
            queueSize: 2,
        });
    });
});

describe("withStorageTiming", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "riffado-storage-timing-"));
    });

    afterEach(async () => {
        setStatusRecordingEnabled(false);
        await rm(dir, { recursive: true, force: true });
    });

    it("keeps the direct URL capability exactly when the wrapped provider has it", async () => {
        setStatusRecordingEnabled(true);
        const local = withStorageTiming(new LocalStorage(dir));
        const remote = withStorageTiming(s3());

        expect(local.getDirectDownloadUrl).toBeUndefined();
        expect(remote.getDirectDownloadUrl).toBeTypeOf("function");
        const url = await remote.getDirectDownloadUrl?.("k", {
            expiresInSeconds: 60,
            contentType: "audio/mpeg",
        });
        expect(url).toContain("response-content-type=audio%2Fmpeg");
    });
});
