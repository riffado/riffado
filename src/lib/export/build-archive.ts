import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { decryptJsonField, decryptText } from "@/lib/encryption/fields";
import type { StorageProvider } from "@/lib/storage/types";

export interface ArchiveResult {
    recordingCount: number;
    fileSize: number;
}

interface ManifestRecording {
    id: string;
    filename: string;
    startTime: string;
    endTime: string;
    duration: number;
    filesize: number;
    deviceSn: string;
    audio: { included: boolean; path: string | null; reason?: string };
    transcript: { included: boolean; path: string | null };
    summary: { included: boolean; path: string | null };
}

function audioExtension(storagePath: string): string {
    const match = storagePath.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : "mp3";
}

/** Filesystem-safe, stable folder name per recording inside the archive. */
function folderName(recording: { id: string; startTime: Date }): string {
    const iso = recording.startTime.toISOString().replace(/[:.]/g, "-");
    return `${iso}_${recording.id}`;
}

/**
 * Streams a full-data archive for `userId` directly into `storage` at
 * `storageKey`. Audio is streamed recording-by-recording straight from
 * storage into the zip and back out to the destination -- at no point is
 * the whole archive, or more than one recording's audio, held in memory.
 *
 * A recording whose audio can't be read (deleted from storage, transient
 * error) doesn't fail the whole export: it's noted in the manifest and
 * skipped, so the user still gets everything else.
 */
export async function buildAndUploadExportArchive(input: {
    userId: string;
    storage: StorageProvider;
    storageKey: string;
    /** Aborting destroys the in-flight zip/upload streams immediately, instead of letting them run to completion in the background after the caller has given up (e.g. on the worker's stall timeout). */
    signal?: AbortSignal;
    /**
     * Called on every unit of forward progress (a chunk of archive bytes
     * written, or a recording's metadata-only entries finished). Lets
     * the caller implement a stall timeout -- "no progress for N
     * minutes" -- instead of a fixed total-duration timeout that would
     * unfairly kill large-but-healthy exports.
     */
    onProgress?: () => void;
}): Promise<ArchiveResult> {
    const { userId, storage, storageKey, signal, onProgress } = input;

    if (signal?.aborted) {
        throw new Error("Export aborted before starting");
    }

    const userRecordings = await db
        .select()
        .from(recordings)
        .where(
            and(eq(recordings.userId, userId), isNull(recordings.deletedAt)),
        );

    const recordingIds = userRecordings.map((r) => r.id);

    const userTranscriptions =
        recordingIds.length > 0
            ? await db
                  .select()
                  .from(transcriptions)
                  .where(eq(transcriptions.userId, userId))
            : [];
    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [t.recordingId, decryptText(t.text)]),
    );

    const userEnhancements =
        recordingIds.length > 0
            ? await db
                  .select()
                  .from(aiEnhancements)
                  .where(eq(aiEnhancements.userId, userId))
            : [];
    // `summary` is a `text` column (encryptText); `actionItems`/`keyPoints`
    // are `jsonb` envelopes (encryptJsonField) -- same at-rest scheme the
    // summary API decrypts before returning to the client.
    const enhancementMap = new Map(
        userEnhancements.map((e) => [
            e.recordingId,
            {
                ...e,
                summary: decryptText(e.summary),
                actionItems: decryptJsonField<string[]>(e.actionItems),
                keyPoints: decryptJsonField<string[]>(e.keyPoints),
            },
        ]),
    );

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const passthrough = new PassThrough();
    // Count bytes as they flow through rather than re-reading the
    // finished archive back out of storage just to learn its size.
    let fileSize = 0;
    passthrough.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
        onProgress?.();
    });
    archive.pipe(passthrough);

    // Surface archiver-level errors (e.g. a mid-stream audio read failure)
    // on the passthrough so the upload promise below rejects instead of
    // hanging forever waiting for a stream that will never finish.
    archive.on("error", (err: Error) => passthrough.destroy(err));
    archive.on("warning", (err: Error) => {
        console.warn(`[export] archiver warning for user ${userId}:`, err);
    });

    const onAbort = () => {
        archive.abort();
        passthrough.destroy(new Error("Export aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const uploadPromise = storage.uploadStream(
        storageKey,
        passthrough,
        "application/zip",
    );

    const manifest: {
        version: string;
        createdAt: string;
        userId: string;
        recordings: ManifestRecording[];
    } = {
        version: "2.0",
        createdAt: new Date().toISOString(),
        userId,
        recordings: [],
    };

    // Resolves once each recording's audio entry has fully settled
    // (archiver finished draining it, or it errored and was ended
    // gracefully) -- awaited below, before the manifest is serialized,
    // so `entry.audio` reflects what actually landed in the archive
    // rather than an optimistic guess made before the stream ran.
    const audioSettled: Promise<void>[] = [];

    for (const recording of userRecordings) {
        // Per-recording DB/metadata work has no byte-stream progress of
        // its own to trigger the passthrough listener above -- mark
        // forward progress explicitly so a library with many small
        // (or audio-less) recordings doesn't false-positive a stall
        // while it's genuinely working through the list.
        onProgress?.();
        const folder = folderName(recording);
        const entry: ManifestRecording = {
            id: recording.id,
            filename: decryptText(recording.filename),
            startTime: recording.startTime.toISOString(),
            endTime: recording.endTime.toISOString(),
            duration: recording.duration,
            filesize: recording.filesize,
            deviceSn: recording.deviceSn,
            audio: { included: false, path: null },
            transcript: { included: false, path: null },
            summary: { included: false, path: null },
        };

        const audioExists = await storage
            .exists(recording.storagePath)
            .catch(() => false);
        if (audioExists) {
            try {
                const rawStream = await storage.downloadStream(
                    recording.storagePath,
                );
                const audioPath = `${folder}/audio.${audioExtension(recording.storagePath)}`;

                // Proxy the raw storage stream through our own PassThrough
                // instead of appending it to the archive directly. A
                // mid-stream error on the raw stream (network drop,
                // storage hiccup) would otherwise surface as an archiver
                // `error` event and abort the *entire* archive -- the
                // try/catch above only covers stream *creation*, not
                // errors emitted while archiver is draining it. Ending
                // the proxy gracefully on such an error instead leaves
                // this one entry truncated (or empty) while every other
                // recording still makes it into the archive.
                const proxy = new PassThrough();
                const settled = new Promise<void>((resolve) => {
                    let done = false;
                    const finish = () => {
                        if (done) return;
                        done = true;
                        resolve();
                    };
                    rawStream.once("error", (err) => {
                        entry.audio = {
                            included: false,
                            path: null,
                            reason: `Audio stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
                        };
                        // Gracefully end the proxy instead of letting the
                        // error propagate into archiver -- archiver treats
                        // a source-stream error as fatal to the whole
                        // archive. Ending early just truncates this one
                        // entry.
                        proxy.end();
                        finish();
                    });
                    proxy.once("error", finish);
                    proxy.once("close", finish);
                    proxy.once("end", finish);
                });
                audioSettled.push(settled);
                rawStream.pipe(proxy);

                // Audio is already compressed (mp3/opus/etc.) -- deflating
                // it again wastes CPU for near-zero size benefit. `store:
                // true` writes it uncompressed into the zip.
                archive.append(proxy, { name: audioPath, store: true });
                entry.audio = { included: true, path: audioPath };
            } catch (error) {
                entry.audio = {
                    included: false,
                    path: null,
                    reason:
                        error instanceof Error ? error.message : String(error),
                };
            }
        } else {
            entry.audio = {
                included: false,
                path: null,
                reason: "Audio file not found in storage",
            };
        }

        const transcriptText = transcriptionMap.get(recording.id);
        if (transcriptText) {
            const transcriptPath = `${folder}/transcript.txt`;
            archive.append(Buffer.from(transcriptText, "utf-8"), {
                name: transcriptPath,
            });
            entry.transcript = { included: true, path: transcriptPath };
        }

        const enhancement = enhancementMap.get(recording.id);
        if (enhancement) {
            const summaryPath = `${folder}/summary.json`;
            archive.append(
                Buffer.from(
                    JSON.stringify(
                        {
                            summary: enhancement.summary,
                            actionItems: enhancement.actionItems,
                            keyPoints: enhancement.keyPoints,
                            provider: enhancement.provider,
                            model: enhancement.model,
                            createdAt: enhancement.createdAt.toISOString(),
                        },
                        null,
                        2,
                    ),
                ),
                { name: summaryPath },
            );
            entry.summary = { included: true, path: summaryPath };
        }

        manifest.recordings.push(entry);
    }

    // Wait for every audio entry to actually settle (archiver finished
    // draining it, or it errored and was gracefully truncated) before
    // serializing the manifest, so `entry.audio` reflects reality
    // instead of the optimistic guess made when the stream was appended.
    await Promise.all(audioSettled);

    archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), {
        name: "manifest.json",
    });

    try {
        await archive.finalize();
        await uploadPromise;
    } finally {
        signal?.removeEventListener("abort", onAbort);
    }

    return { recordingCount: userRecordings.length, fileSize };
}
