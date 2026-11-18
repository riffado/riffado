/**
 * Regression: the export stall guard could abort healthy uploads on slow
 * uplinks.
 *
 * Archives upload in 32 MiB parts, two at a time. While both parts are
 * in flight lib-storage reads nothing more from the archive stream, so
 * the worker saw no progress until a part finished; on an uplink below
 * roughly 1.8 Mbit/s that is longer than the 5-minute stall window.
 * On Node, lib-storage's own `httpUploadProgress` only fires per part
 * (the Node request handler emits no byte-level upload events).
 *
 * After the fix, `uploadStream` takes an `onProgress` callback that the
 * S3 provider calls as each part's bytes are handed to the socket (a
 * request-body wrapper in the client's middleware stack), and on every
 * `httpUploadProgress` event; the archive builder passes its own
 * progress callback through.
 */

import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { S3Storage } from "@/lib/storage/s3-storage";

interface SentRequest {
    method: string;
    query: Record<string, unknown>;
    body: unknown;
}

function s3WithHandler(
    handle: (request: SentRequest) => Promise<void>,
): S3Storage {
    const storage = new S3Storage({
        endpoint: "https://s3.example.com",
        bucket: "riffado",
        region: "auto",
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "secret",
    });
    const client = (
        storage as unknown as {
            client: { config: { requestHandler: unknown } };
        }
    ).client;
    client.config.requestHandler = {
        handle: async (request: SentRequest) => {
            await handle(request);
            return {
                response: {
                    statusCode: 200,
                    headers: { etag: '"etag"' },
                    body: Readable.from([]),
                },
            };
        },
        updateHttpClientConfig: () => {},
        httpHandlerConfigs: () => ({}),
    };
    return storage;
}

async function drain(body: unknown): Promise<number> {
    if (!(body instanceof Readable)) {
        return body instanceof Uint8Array ? body.byteLength : 0;
    }
    let bytes = 0;
    for await (const chunk of body) bytes += (chunk as Buffer).length;
    return bytes;
}

describe("S3 upload progress", () => {
    it("reports progress while a part's bytes are being sent, not only when it finishes", async () => {
        let progressBeforeRequestEnded = 0;
        let progressCalls = 0;
        const onProgress = vi.fn(() => {
            progressCalls += 1;
        });
        const sentBytes: number[] = [];
        const storage = s3WithHandler(async (request) => {
            sentBytes.push(await drain(request.body));
            progressBeforeRequestEnded = progressCalls;
        });
        const payload = Buffer.alloc(3 * 1024 * 1024, 1);

        await storage.uploadStream(
            "exports/u/job.zip",
            Readable.from([payload]),
            "application/zip",
            { onProgress },
        );

        expect(sentBytes).toEqual([payload.length]);
        expect(progressBeforeRequestEnded).toBeGreaterThanOrEqual(40);
    });

    it("forwards lib-storage httpUploadProgress events", async () => {
        const onProgress = vi.fn();
        const storage = s3WithHandler(async (request) => {
            await drain(request.body);
        });

        await storage.uploadStream(
            "exports/u/job.zip",
            Readable.from([Buffer.from("zip")]),
            "application/zip",
            { onProgress },
        );

        expect(onProgress).toHaveBeenCalledWith(
            expect.objectContaining({ loaded: 3, total: 3 }),
        );
    });

    it("leaves other requests and uploads without a callback untouched", async () => {
        const bodies: unknown[] = [];
        const storage = s3WithHandler(async (request) => {
            bodies.push(request.body);
            await drain(request.body);
        });

        await storage.uploadStream(
            "exports/u/job.zip",
            Readable.from([Buffer.from("zip")]),
            "application/zip",
        );
        await storage.uploadFile("u/a.ogg", Buffer.from("ogg"), "audio/ogg");

        for (const body of bodies) {
            expect(body).toBeInstanceOf(Uint8Array);
        }
    });
});
