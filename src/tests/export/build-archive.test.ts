import { Readable } from "node:stream";
import unzipper from "unzipper";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "@/lib/storage/types";

const { dbMock } = vi.hoisted(() => ({ dbMock: { select: vi.fn() } }));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    recordings: "recordings",
    transcriptions: "transcriptions",
    aiEnhancements: "aiEnhancements",
}));
vi.mock("@/lib/encryption/fields", () => ({
    decryptText: (v: string | null) => (v == null ? v : `decrypted:${v}`),
    decryptJsonField: (v: unknown) =>
        Array.isArray(v) ? v.map((x) => `decrypted:${x}`) : v,
}));

type Row = Record<string, unknown>;

function mockSelectSequence(results: Row[][]) {
    let call = 0;
    dbMock.select.mockImplementation(() => ({
        from: () => ({
            where: () => Promise.resolve(results[call++] ?? []),
        }),
    }));
}

import { buildAndUploadExportArchive } from "@/lib/export/build-archive";

/** In-memory StorageProvider that captures the uploaded archive bytes. */
class FakeStorage implements StorageProvider {
    uploaded: Buffer | null = null;
    files = new Map<string, Buffer>();
    /** Paths that `exists()` reports present but `downloadStream()` returns a `StuckReadable` for. */
    stuckPaths = new Set<string>();

    async uploadFile(key: string, buffer: Buffer): Promise<string> {
        this.files.set(key, buffer);
        return key;
    }
    async downloadFile(key: string): Promise<Buffer> {
        const buf = this.files.get(key);
        if (!buf) throw new Error("not found");
        return buf;
    }
    async downloadStream(key: string): Promise<Readable> {
        if (this.stuckPaths.has(key)) return new StuckReadable();
        const buf = this.files.get(key);
        if (!buf) throw new Error(`not found: ${key}`);
        return Readable.from(buf);
    }
    async uploadStream(
        key: string,
        stream: Readable,
        _contentType: string,
    ): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        this.uploaded = Buffer.concat(chunks);
        return key;
    }
    async exists(key: string): Promise<boolean> {
        return this.files.has(key) || this.stuckPaths.has(key);
    }
    async getSignedUrl(): Promise<string> {
        return "https://example.com/signed";
    }
    async deleteFile(key: string): Promise<void> {
        this.files.delete(key);
    }
    async testConnection(): Promise<boolean> {
        return true;
    }
}

/**
 * A stream that never produces data and, crucially, never finishes
 * being destroyed -- `_destroy` deliberately never calls its callback.
 * Simulates archiver having stopped draining a source stream without
 * formally ending it: nothing about this stream will ever emit
 * `end`/`close`/`error` on its own. Used to prove that aborting
 * `buildAndUploadExportArchive` rejects via the abort-signal race
 * itself, not as a side effect of stream teardown completing.
 */
class StuckReadable extends Readable {
    _read(): void {
        // Never pushes data, never calls this.push(null).
    }
    _destroy(
        _err: Error | null,
        _callback: (error?: Error | null) => void,
    ): void {
        // Deliberately never calls `_callback`.
    }
}

interface ZipEntry {
    buffer: Buffer;
    /** 0 = stored (no compression), 8 = deflate. */
    compressionMethod: number;
}

async function readZipEntries(buffer: Buffer): Promise<Map<string, ZipEntry>> {
    const entries = new Map<string, ZipEntry>();
    const directory = await unzipper.Open.buffer(buffer);
    for (const file of directory.files) {
        entries.set(file.path, {
            buffer: await file.buffer(),
            compressionMethod: file.compressionMethod,
        });
    }
    return entries;
}

describe("buildAndUploadExportArchive", () => {
    let storage: FakeStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new FakeStorage();
    });

    it("bundles audio, transcript, and summary per recording plus a manifest", async () => {
        storage.files.set("audio/rec-1.mp3", Buffer.from("fake-audio-bytes-1"));

        mockSelectSequence([
            [
                {
                    id: "rec-1",
                    userId: "user-1",
                    filename: "enc-filename",
                    startTime: new Date("2026-01-01T00:00:00Z"),
                    endTime: new Date("2026-01-01T00:01:00Z"),
                    duration: 60000,
                    filesize: 18,
                    deviceSn: "SN123",
                    storagePath: "audio/rec-1.mp3",
                },
            ],
            [
                {
                    recordingId: "rec-1",
                    text: "enc-transcript",
                },
            ],
            [
                {
                    recordingId: "rec-1",
                    summary: "A concise summary",
                    actionItems: ["do a thing"],
                    keyPoints: ["key point"],
                    provider: "openai",
                    model: "gpt-4o",
                    createdAt: new Date("2026-01-01T00:02:00Z"),
                },
            ],
        ]);

        const result = await buildAndUploadExportArchive({
            userId: "user-1",
            storage,
            storageKey: "exports/user-1/job-1.zip",
        });

        expect(result.recordingCount).toBe(1);
        expect(result.fileSize).toBeGreaterThan(0);
        expect(storage.uploaded).not.toBeNull();

        const entries = await readZipEntries(storage.uploaded as Buffer);
        const names = [...entries.keys()];
        expect(names).toContain("manifest.json");
        expect(names.some((n) => n.endsWith("/audio.mp3"))).toBe(true);
        expect(names.some((n) => n.endsWith("/transcript.txt"))).toBe(true);
        expect(names.some((n) => n.endsWith("/summary.json"))).toBe(true);

        const manifest = JSON.parse(
            entries.get("manifest.json")?.buffer.toString("utf-8") ?? "{}",
        );
        expect(manifest.recordings).toHaveLength(1);
        expect(manifest.recordings[0].audio.included).toBe(true);
        expect(manifest.recordings[0].transcript.included).toBe(true);
        expect(manifest.recordings[0].summary.included).toBe(true);
        expect(manifest.recordings[0].filename).toBe("decrypted:enc-filename");

        const transcriptEntry = [...entries.entries()].find(([n]) =>
            n.endsWith("/transcript.txt"),
        );
        expect(transcriptEntry?.[1].buffer.toString("utf-8")).toBe(
            "decrypted:enc-transcript",
        );

        // Regression: the summary must go through decryptText/
        // decryptJsonField before landing in the archive, same as the
        // transcript -- otherwise the "summary.json" entry would contain
        // ciphertext instead of the user's readable summary.
        const summaryEntry = [...entries.entries()].find(([n]) =>
            n.endsWith("/summary.json"),
        );
        const summaryJson = JSON.parse(
            summaryEntry?.[1].buffer.toString("utf-8") ?? "{}",
        );
        expect(summaryJson.summary).toBe("decrypted:A concise summary");
        expect(summaryJson.actionItems).toEqual(["decrypted:do a thing"]);
        expect(summaryJson.keyPoints).toEqual(["decrypted:key point"]);

        // Audio is already-compressed media -- deflating it again wastes
        // CPU for no size benefit, so it should be stored (method 0), not
        // deflated (method 8). The small text entries are worth deflating.
        const audioEntry = [...entries.entries()].find(([n]) =>
            n.endsWith("/audio.mp3"),
        );
        expect(audioEntry?.[1].compressionMethod).toBe(0);
        expect(entries.get("manifest.json")?.compressionMethod).toBe(8);
    });

    it("skips missing audio without failing the whole export, and notes why in the manifest", async () => {
        // No file registered at this storagePath -- exists() returns false.
        mockSelectSequence([
            [
                {
                    id: "rec-missing",
                    userId: "user-1",
                    filename: "enc-filename",
                    startTime: new Date("2026-01-01T00:00:00Z"),
                    endTime: new Date("2026-01-01T00:01:00Z"),
                    duration: 1000,
                    filesize: 0,
                    deviceSn: "SN1",
                    storagePath: "audio/does-not-exist.mp3",
                },
            ],
            [],
            [],
        ]);

        const result = await buildAndUploadExportArchive({
            userId: "user-1",
            storage,
            storageKey: "exports/user-1/job-2.zip",
        });

        expect(result.recordingCount).toBe(1);
        const entries = await readZipEntries(storage.uploaded as Buffer);
        const manifest = JSON.parse(
            entries.get("manifest.json")?.buffer.toString("utf-8") ?? "{}",
        );
        expect(manifest.recordings[0].audio.included).toBe(false);
        expect(manifest.recordings[0].audio.reason).toBeTruthy();
        // No audio entry should have been written for this recording.
        expect([...entries.keys()].some((n) => n.includes("audio"))).toBe(
            false,
        );
    });

    it("aborts and rejects immediately when the signal is already aborted", async () => {
        mockSelectSequence([[], [], []]);
        const controller = new AbortController();
        controller.abort();

        await expect(
            buildAndUploadExportArchive({
                userId: "user-1",
                storage,
                storageKey: "exports/user-1/job-3.zip",
                signal: controller.signal,
            }),
        ).rejects.toThrow();
    });

    it("produces an empty-but-valid archive (manifest only) for a user with no recordings", async () => {
        mockSelectSequence([[], [], []]);

        const result = await buildAndUploadExportArchive({
            userId: "user-1",
            storage,
            storageKey: "exports/user-1/job-4.zip",
        });

        expect(result.recordingCount).toBe(0);
        const entries = await readZipEntries(storage.uploaded as Buffer);
        expect([...entries.keys()]).toEqual(["manifest.json"]);
    });

    it("rejects (rather than hanging forever) when aborted while waiting for a stuck audio stream to settle", async () => {
        // Regression: the pre-manifest `await` on every audio entry
        // settling was not raced against `signal`, so an abort while an
        // entry was still draining (or stuck) would hang the whole
        // function instead of rejecting -- silently defeating the
        // worker's stall/max-duration guard, which needs this promise to
        // actually settle to stop the job.
        storage.stuckPaths.add("audio/stuck.mp3");
        mockSelectSequence([
            [
                {
                    id: "rec-stuck",
                    userId: "user-1",
                    filename: "enc-filename",
                    startTime: new Date("2026-01-01T00:00:00Z"),
                    endTime: new Date("2026-01-01T00:01:00Z"),
                    duration: 1000,
                    filesize: 100,
                    deviceSn: "SN1",
                    storagePath: "audio/stuck.mp3",
                },
            ],
            [],
            [],
        ]);

        const controller = new AbortController();
        const promise = buildAndUploadExportArchive({
            userId: "user-1",
            storage,
            storageKey: "exports/user-1/job-5.zip",
            signal: controller.signal,
        });
        // Let the build start and reach the audio-settled wait, then abort.
        setTimeout(() => controller.abort(), 20);

        await expect(promise).rejects.toThrow(/abort/i);
    }, 5000);
});
