import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, recordings, userSettings, users } from "@/db/schema";
import { encryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { sendNewRecordingBarkNotification } from "@/lib/notifications/bark";
import { sendNewRecordingEmail } from "@/lib/notifications/email";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";
import type { PlaudRecording } from "@/types/plaud";

/**
 * Sync configuration constants
 */
const SYNC_CONFIG = {
    /** Number of recordings to fetch per API call */
    PAGE_SIZE: 50,
    /** Number of recordings to download concurrently */
    BATCH_CONCURRENCY: 5,
    /** Maximum pages to process in a single sync (prevents runaway) */
    MAX_PAGES: 20,
} as const;

interface SyncResult {
    newRecordings: number;
    updatedRecordings: number;
    errors: string[];
    /** IDs of recordings that need transcription */
    pendingTranscriptionIds: string[];
}

interface SyncContext {
    userId: string;
    autoTranscribe: boolean;
    emailNotifications: boolean;
    barkNotifications: boolean;
    notificationEmail: string | null;
    barkPushUrl: string | null;
}

/**
 * Generate a unique storage key for a recording, appending (2), (3) etc.
 * if another recording with the same name already exists in the DB.
 */
async function uniqueStorageKey(
    userId: string,
    baseName: string,
    ext: string,
    plaudFileId: string,
): Promise<string> {
    const candidate = (suffix: string) =>
        `${userId}/${baseName}${suffix}.${ext}`;

    for (let i = 0; i < 100; i++) {
        const suffix = i === 0 ? "" : ` (${i + 1})`;
        const key = candidate(suffix);
        const [existing] = await db
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, userId),
                    eq(recordings.storagePath, key),
                    ne(recordings.plaudFileId, plaudFileId),
                ),
            )
            .limit(1);
        if (!existing) return key;
    }
    // Absolute fallback: use the plaud ID
    return `${userId}/${plaudFileId}.${ext}`;
}

/**
 * Process a single recording - download and save to database
 */
async function processRecording(
    plaudRecording: PlaudRecording,
    context: SyncContext,
    plaudClient: Awaited<ReturnType<typeof createPlaudClient>>,
    storage: Awaited<ReturnType<typeof createUserStorageProvider>>,
): Promise<{
    status: "new" | "updated" | "skipped" | "error";
    recordingId?: string;
    filename?: string;
    error?: string;
}> {
    try {
        const [existingRecording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.plaudFileId, plaudRecording.id),
                    eq(recordings.userId, context.userId),
                ),
            )
            .limit(1);

        const versionKey = plaudRecording.version_ms.toString();

        // Skip if already synced with same version
        if (
            existingRecording &&
            existingRecording.plaudVersion === versionKey
        ) {
            return { status: "skipped" };
        }

        // Tombstone: user soft-deleted this recording in OpenPlaud's UI.
        // Do not re-download or update — sync is keyed on plaudFileId, and
        // the row is retained specifically to suppress resurrection. See #56.
        if (existingRecording?.deletedAt) {
            return { status: "skipped" };
        }

        // Download the audio file
        const audioBuffer = await plaudClient.downloadRecording(
            plaudRecording.id,
            false,
        );

        const fileExtension = "mp3";
        const safeName =
            plaudRecording.filename.replace(/[/\\:*?"<>|]/g, "-").trim() ||
            plaudRecording.id;
        const storageKey = await uniqueStorageKey(
            context.userId,
            safeName,
            fileExtension,
            plaudRecording.id,
        );
        const contentType = "audio/mpeg";
        await storage.uploadFile(storageKey, audioBuffer, contentType);

        const recordingData = {
            userId: context.userId,
            deviceSn: plaudRecording.serial_number,
            plaudFileId: plaudRecording.id,
            // Filename comes from Plaud as plaintext and may carry topic
            // info; encrypt at rest. Notification surfaces below receive
            // the original `plaudRecording.filename` directly, which is
            // the right contract — the encrypted form never leaves the DB.
            filename: encryptText(plaudRecording.filename),
            duration: plaudRecording.duration,
            startTime: new Date(plaudRecording.start_time),
            endTime: new Date(plaudRecording.end_time),
            filesize: plaudRecording.filesize,
            fileMd5: plaudRecording.file_md5,
            storageType: env.DEFAULT_STORAGE_TYPE,
            storagePath: storageKey,
            downloadedAt: new Date(),
            plaudVersion: versionKey,
            timezone: plaudRecording.timezone,
            zonemins: plaudRecording.zonemins,
            scene: plaudRecording.scene,
            isTrash: plaudRecording.is_trash,
        };

        if (existingRecording) {
            // The pre-download `select` happened before the slow
            // download/upload above. A concurrent DELETE could have
            // tombstoned the row in the meantime. Re-check under a row
            // lock so we don't resurrect a deleted recording, and only
            // emit `recording.updated` when we actually wrote.
            const updated = await db.transaction(async (tx) => {
                const [locked] = await tx
                    .select({ deletedAt: recordings.deletedAt })
                    .from(recordings)
                    .where(
                        and(
                            eq(recordings.id, existingRecording.id),
                            eq(recordings.userId, context.userId),
                        ),
                    )
                    .for("update")
                    .limit(1);

                if (!locked || locked.deletedAt) return false;

                await tx
                    .update(recordings)
                    .set({ ...recordingData, updatedAt: new Date() })
                    .where(
                        and(
                            eq(recordings.id, existingRecording.id),
                            eq(recordings.userId, context.userId),
                        ),
                    );
                return true;
            });

            if (!updated) {
                // Concurrent DELETE tombstoned the recording while we
                // were downloading/uploading. The just-uploaded blob
                // would otherwise be orphaned because we're no longer
                // writing the recordings row that references it. Best
                // effort cleanup; storage "already gone" is acceptable.
                try {
                    await storage.deleteFile(storageKey);
                } catch (cleanupError) {
                    console.error(
                        `Failed to clean up orphaned storage object ${storageKey} after concurrent delete:`,
                        cleanupError,
                    );
                }
                return { status: "skipped" };
            }

            await emitEvent(
                "recording.updated",
                context.userId,
                existingRecording.id,
            );
            return {
                status: "updated",
                recordingId: existingRecording.id,
                filename: plaudRecording.filename,
            };
        }

        // Insert new recording. Concurrent inserts of the same plaud_file_id
        // by parallel sync runs are caught by the (user_id, plaud_file_id)
        // unique constraint and surface as an error to the caller.
        const [newRecording] = await db
            .insert(recordings)
            .values(recordingData)
            .returning({ id: recordings.id });

        await emitEvent("recording.synced", context.userId, newRecording.id);

        return {
            status: "new",
            recordingId: newRecording.id,
            filename: plaudRecording.filename,
        };
    } catch (error) {
        return {
            status: "error",
            error: `Failed to sync ${plaudRecording.filename}: ${error}`,
        };
    }
}

/**
 * Process a batch of recordings concurrently
 */
async function processBatch(
    batch: PlaudRecording[],
    context: SyncContext,
    plaudClient: Awaited<ReturnType<typeof createPlaudClient>>,
    storage: Awaited<ReturnType<typeof createUserStorageProvider>>,
): Promise<{
    newCount: number;
    updatedCount: number;
    errors: string[];
    newRecordingIds: string[];
    newRecordingNames: string[];
}> {
    const results = await Promise.allSettled(
        batch.map((rec) =>
            processRecording(rec, context, plaudClient, storage),
        ),
    );

    let newCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];
    const newRecordingIds: string[] = [];
    const newRecordingNames: string[] = [];

    for (const result of results) {
        if (result.status === "fulfilled") {
            const { status, recordingId, filename, error } = result.value;
            if (status === "new" && recordingId) {
                newCount++;
                newRecordingIds.push(recordingId);
                if (filename) newRecordingNames.push(filename);
            } else if (status === "updated") {
                updatedCount++;
            } else if (status === "error" && error) {
                errors.push(error);
            }
        } else {
            errors.push(`Batch processing error: ${result.reason}`);
        }
    }

    return {
        newCount,
        updatedCount,
        errors,
        newRecordingIds,
        newRecordingNames,
    };
}

/**
 * Sync recordings for a user with optimized batch processing
 *
 * Optimizations:
 * - Fetches recordings in pages (50 at a time)
 * - Downloads concurrently in batches (5 at a time)
 * - Queues transcription for after sync completes
 * - Stops early if no new recordings found
 */
export async function syncRecordingsForUser(
    userId: string,
): Promise<SyncResult> {
    const result: SyncResult = {
        newRecordings: 0,
        updatedRecordings: 0,
        errors: [],
        pendingTranscriptionIds: [],
    };

    try {
        // Get connection
        const [connection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, userId))
            .limit(1);

        if (!connection) {
            result.errors.push("No Plaud connection found");
            return result;
        }

        // Get user settings
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const [user] = await db
            .select({
                email: users.email,
                suspendedAt: users.suspendedAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        // Suspension check (cooperative). If an admin has suspended this user
        // we exit before doing any work. In-flight syncs are not interrupted;
        // this only stops the next claim. Self-host never sets suspendedAt
        // because the admin gate is locked behind IS_HOSTED, so this branch
        // is dead code there.
        if (user?.suspendedAt) {
            result.errors.push("User is suspended");
            return result;
        }

        const context: SyncContext = {
            userId,
            autoTranscribe: settings?.autoTranscribe ?? false,
            emailNotifications: settings?.emailNotifications ?? false,
            barkNotifications: settings?.barkNotifications ?? false,
            notificationEmail:
                settings?.notificationEmail || user?.email || null,
            barkPushUrl: settings?.barkPushUrl || null,
        };

        const plaudClient = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
            connection.workspaceId,
        );
        const storage = await createUserStorageProvider(userId);
        const allNewRecordingNames: string[] = [];

        // Paginated sync - fetch newest first
        let page = 0;
        let hasMore = true;
        let consecutiveEmptyPages = 0;

        while (hasMore && page < SYNC_CONFIG.MAX_PAGES) {
            const skip = page * SYNC_CONFIG.PAGE_SIZE;
            const recordingsResponse = await plaudClient.getRecordings(
                skip,
                SYNC_CONFIG.PAGE_SIZE,
                0, // not trash
                "edit_time",
                true, // descending (newest first)
            );

            const plaudRecordings = recordingsResponse.data_file_list;

            if (plaudRecordings.length === 0) {
                break;
            }

            // Process in concurrent batches
            for (
                let i = 0;
                i < plaudRecordings.length;
                i += SYNC_CONFIG.BATCH_CONCURRENCY
            ) {
                const batch = plaudRecordings.slice(
                    i,
                    i + SYNC_CONFIG.BATCH_CONCURRENCY,
                );
                const batchResult = await processBatch(
                    batch,
                    context,
                    plaudClient,
                    storage,
                );

                result.newRecordings += batchResult.newCount;
                result.updatedRecordings += batchResult.updatedCount;
                result.errors.push(...batchResult.errors);
                result.pendingTranscriptionIds.push(
                    ...batchResult.newRecordingIds,
                );
                allNewRecordingNames.push(...batchResult.newRecordingNames);
            }

            // Early exit optimization: if we got fewer recordings than requested,
            // or if we had no new/updated recordings for 2 pages, we're done
            if (plaudRecordings.length < SYNC_CONFIG.PAGE_SIZE) {
                hasMore = false;
            } else if (
                result.newRecordings === 0 &&
                result.updatedRecordings === 0
            ) {
                consecutiveEmptyPages++;
                if (consecutiveEmptyPages >= 2) {
                    hasMore = false;
                }
            } else {
                consecutiveEmptyPages = 0;
            }

            page++;
        }

        // Update last sync time, plus the workspaceId if it was resolved or
        // changed during this run (cache-empty backfill or stale-cache rescue).
        // Always scope user-owned UPDATEs by userId in addition to the
        // primary key, per AGENTS.md "User-Scoped Queries" rule.
        const resolvedWorkspaceId = plaudClient.workspaceId;
        const workspaceIdChanged =
            !!resolvedWorkspaceId &&
            resolvedWorkspaceId !== connection.workspaceId;
        await db
            .update(plaudConnections)
            .set({
                lastSync: new Date(),
                ...(workspaceIdChanged
                    ? { workspaceId: resolvedWorkspaceId }
                    : {}),
            })
            .where(
                and(
                    eq(plaudConnections.id, connection.id),
                    eq(plaudConnections.userId, userId),
                ),
            );

        // Send notifications
        if (
            context.emailNotifications &&
            context.notificationEmail &&
            result.newRecordings > 0
        ) {
            try {
                await sendNewRecordingEmail(
                    context.notificationEmail,
                    result.newRecordings,
                    allNewRecordingNames,
                );
            } catch (error) {
                console.error("Failed to send email notification:", error);
                result.errors.push("Email notification failed");
            }
        }

        if (
            context.barkNotifications &&
            context.barkPushUrl &&
            result.newRecordings > 0
        ) {
            try {
                const success = await sendNewRecordingBarkNotification(
                    context.barkPushUrl,
                    result.newRecordings,
                    allNewRecordingNames,
                );
                if (!success) {
                    result.errors.push("Bark notification failed or timed out");
                }
            } catch (error) {
                console.error("Failed to send Bark notification:", error);
                result.errors.push("Bark notification failed");
            }
        }

        // Queue transcription for new recordings (runs after sync response)
        if (
            context.autoTranscribe &&
            result.pendingTranscriptionIds.length > 0
        ) {
            // Run transcription in background, don't await
            queueTranscriptions(userId, result.pendingTranscriptionIds).catch(
                (error) => {
                    console.error("Background transcription failed:", error);
                },
            );
        }

        return result;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        result.errors.push(`Sync failed: ${errorMessage}`);
        return result;
    }
}

/**
 * Queue transcriptions to run in background
 * This is fire-and-forget to not block the sync response
 */
async function queueTranscriptions(
    userId: string,
    recordingIds: string[],
): Promise<void> {
    for (const recordingId of recordingIds) {
        try {
            await transcribeRecording(userId, recordingId);
        } catch (error) {
            console.error(
                `Auto-transcription failed for recording ${recordingId}:`,
                error,
            );
        }
    }
}
