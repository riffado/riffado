/**
 * Regression: in-app audio playback re-read the whole object per request.
 *
 * `GET /api/recordings/[id]/audio` downloaded the entire object from
 * storage into memory for every request, including each Range request a
 * seek makes, then sliced it, and marked authenticated audio
 * `Cache-Control: public, immutable`.
 *
 * After the fix:
 *   1. A media element (`Sec-Fetch-Dest: audio`) on storage with its own
 *      endpoint is redirected to a short-lived storage URL whose
 *      Content-Type override matches what the route served before
 *      (extension-based, so `.ogg`/`.opus` Plaud recordings from #160 stay
 *      `audio/ogg`).
 *   2. Everything else streams, passing Range through to the provider.
 *      Only a single `bytes=start-end` or suffix `bytes=-N` range is
 *      honored; multiple, malformed or inverted ranges get the full body
 *      (RFC 9110), and a start past the end gets 416 with an unsatisfied
 *      Content-Range.
 *   3. `download=1` still streams a complete attachment, and `stream=1`
 *      (the player's fallback when the browser cannot reach the storage
 *      endpoint) is never redirected.
 *   4. Authenticated audio is never cached publicly, cacheable responses
 *      vary on `Sec-Fetch-Dest`, and a missing object is a 404.
 */

import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
    captureServerEvent: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string) => value),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn(),
}));

import { GET as getAudio } from "@/app/api/recordings/[id]/audio/route";
import { db } from "@/db";
import { createUserStorageProvider } from "@/lib/storage/factory";

const audioBytes = Buffer.from("0123456789");
const SIGNED_URL = "https://storage.example.com/bucket/key?X-Amz-Signature=x";

function selectRecording(storagePath: string) {
    (db.select as Mock).mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [
                    {
                        id: "rec-1",
                        userId: "user-1",
                        filename: "Planning Call",
                        storageType: "s3",
                        storagePath,
                        deletedAt: null,
                    },
                ],
            }),
        }),
    });
}

function provider(withDirectUrl: boolean) {
    return {
        downloadFile: vi.fn().mockResolvedValue(audioBytes),
        getObjectSize: vi.fn().mockResolvedValue(audioBytes.length),
        downloadStream: vi.fn(
            async (_key: string, range?: { start: number; end: number }) =>
                Readable.from(
                    range
                        ? audioBytes.subarray(range.start, range.end + 1)
                        : audioBytes,
                ),
        ),
        ...(withDirectUrl && {
            getDirectDownloadUrl: vi.fn().mockResolvedValue(SIGNED_URL),
        }),
    };
}

function request(query = "", headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost/api/recordings/rec-1/audio${query}`, {
        headers,
    });
}

const params = { params: Promise.resolve({ id: "rec-1" }) };

describe("in-app audio route storage reads", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("redirects a media element to a short-lived storage URL with the route's content type", async () => {
        selectRecording("user-1/plaud-1.opus");
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("", { "sec-fetch-dest": "audio", range: "bytes=0-" }),
            params,
        );

        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(SIGNED_URL);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(storage.getDirectDownloadUrl).toHaveBeenCalledWith(
            "user-1/plaud-1.opus",
            { expiresInSeconds: 900, contentType: "audio/ogg" },
        );
        expect(storage.downloadFile).not.toHaveBeenCalled();
        expect(storage.downloadStream).not.toHaveBeenCalled();
    });

    it("never redirects a stream=1 request, even for a media element", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("?stream=1", {
                "sec-fetch-dest": "audio",
                range: "bytes=2-5",
            }),
            params,
        );

        expect(response.status).toBe(206);
        expect(response.headers.get("Location")).toBeNull();
        expect(storage.getDirectDownloadUrl).not.toHaveBeenCalled();
        expect(await response.text()).toBe("2345");
    });

    it("keeps the extension-based type for legacy .mp3 keys", async () => {
        selectRecording("user-1/legacy.mp3");
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        await getAudio(request("", { "sec-fetch-dest": "audio" }), params);

        expect(storage.getDirectDownloadUrl).toHaveBeenCalledWith(
            "user-1/legacy.mp3",
            { expiresInSeconds: 900, contentType: "audio/mpeg" },
        );
    });

    it("streams fetch() reads instead of redirecting, so cross-origin CORS is never needed", async () => {
        selectRecording("user-1/plaud-1.opus");
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("", { "sec-fetch-dest": "empty" }),
            params,
        );

        expect(response.status).toBe(200);
        expect(storage.getDirectDownloadUrl).not.toHaveBeenCalled();
        expect(storage.downloadFile).not.toHaveBeenCalled();
        expect(storage.downloadStream).toHaveBeenCalledWith(
            "user-1/plaud-1.opus",
        );
        expect(response.headers.get("Content-Type")).toBe("audio/ogg");
        expect(response.headers.get("Content-Length")).toBe("10");
        expect(Buffer.from(await response.arrayBuffer())).toEqual(audioBytes);
    });

    it("passes Range through to the provider instead of reading the whole object", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(false);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("", { "sec-fetch-dest": "audio", range: "bytes=2-5" }),
            params,
        );

        expect(response.status).toBe(206);
        expect(storage.downloadFile).not.toHaveBeenCalled();
        expect(storage.downloadStream).toHaveBeenCalledWith("user-1/rec.mp3", {
            start: 2,
            end: 5,
        });
        expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
        expect(response.headers.get("Content-Length")).toBe("4");
        expect(await response.text()).toBe("2345");
    });

    it("clamps an oversized range end and rejects a start past the end", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(false);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const clamped = await getAudio(
            request("", { range: "bytes=8-100" }),
            params,
        );
        expect(clamped.status).toBe(206);
        expect(clamped.headers.get("Content-Range")).toBe("bytes 8-9/10");
        expect(await clamped.text()).toBe("89");

        const unsatisfiable = await getAudio(
            request("", { range: "bytes=10-" }),
            params,
        );
        expect(unsatisfiable.status).toBe(416);
        expect(unsatisfiable.headers.get("Content-Range")).toBe("bytes */10");
        expect(unsatisfiable.headers.get("Cache-Control")).toBe(
            "private, no-store",
        );
    });

    it("serves suffix ranges from the end of the object", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(false);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const tail = await getAudio(request("", { range: "bytes=-3" }), params);
        expect(tail.status).toBe(206);
        expect(tail.headers.get("Content-Range")).toBe("bytes 7-9/10");
        expect(await tail.text()).toBe("789");

        const longer = await getAudio(
            request("", { range: "bytes=-100" }),
            params,
        );
        expect(longer.status).toBe(206);
        expect(longer.headers.get("Content-Range")).toBe("bytes 0-9/10");
        expect(await longer.text()).toBe("0123456789");

        const empty = await getAudio(
            request("", { range: "bytes=-0" }),
            params,
        );
        expect(empty.status).toBe(416);
    });

    it.each([
        ["multiple ranges", "bytes=0-1,4-5"],
        ["another unit", "items=0-1"],
        ["a prefix before the unit", "xbytes=2-5"],
        ["non-numeric bounds", "bytes=a-b"],
        ["no bounds", "bytes=-"],
        ["an inverted range", "bytes=5-2"],
    ])("ignores Range with %s and returns the full body", async (_label, range) => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(false);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(request("", { range }), params);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Range")).toBeNull();
        expect(storage.downloadStream).toHaveBeenCalledWith("user-1/rec.mp3");
        expect(await response.text()).toBe("0123456789");
    });

    it("varies cacheable responses on Sec-Fetch-Dest", async () => {
        selectRecording("user-1/rec.mp3");
        (createUserStorageProvider as Mock).mockResolvedValue(provider(false));

        const full = await getAudio(request(), params);
        const ranged = await getAudio(
            request("", { range: "bytes=0-1" }),
            params,
        );

        expect(full.headers.get("Vary")).toBe("Sec-Fetch-Dest");
        expect(ranged.headers.get("Vary")).toBe("Sec-Fetch-Dest");
    });

    it("returns 404 instead of 500 when the audio object is missing from storage", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(false);
        storage.getObjectSize.mockRejectedValue(
            Object.assign(new Error("NotFound"), {
                name: "NotFound",
                $metadata: { httpStatusCode: 404 },
            }),
        );
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(request(), params);

        expect(response.status).toBe(404);
        expect(storage.downloadStream).not.toHaveBeenCalled();
    });

    it("returns 404 for a recording the user does not own, even for a media element", async () => {
        (db.select as Mock).mockReturnValue({
            from: () => ({
                where: () => ({ limit: async () => [] }),
            }),
        });
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("", { "sec-fetch-dest": "audio" }),
            params,
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("Location")).toBeNull();
        expect(storage.getDirectDownloadUrl).not.toHaveBeenCalled();
        expect(storage.downloadStream).not.toHaveBeenCalled();
    });

    it("streams a complete attachment for download=1 even when a storage URL is available", async () => {
        selectRecording("user-1/rec.mp3");
        const storage = provider(true);
        (createUserStorageProvider as Mock).mockResolvedValue(storage);

        const response = await getAudio(
            request("?download=1", {
                "sec-fetch-dest": "document",
                range: "bytes=0-3",
            }),
            params,
        );

        expect(response.status).toBe(200);
        expect(storage.getDirectDownloadUrl).not.toHaveBeenCalled();
        expect(response.headers.get("Content-Disposition")).toContain(
            "Planning Call.mp3",
        );
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.text()).toBe("0123456789");
    });

    it("never marks authenticated audio as publicly cacheable", async () => {
        selectRecording("user-1/rec.mp3");
        (createUserStorageProvider as Mock).mockResolvedValue(provider(false));

        const full = await getAudio(request(), params);
        const ranged = await getAudio(
            request("", { range: "bytes=0-1" }),
            params,
        );

        for (const response of [full, ranged]) {
            const cacheControl = response.headers.get("Cache-Control") ?? "";
            expect(cacheControl).toContain("private");
            expect(cacheControl).not.toContain("public");
            expect(cacheControl).not.toContain("immutable");
        }
    });
});
