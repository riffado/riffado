import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
    aiEnhancements,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
    users,
} from "@/db/schema";
import { encryptText } from "@/lib/encryption/fields";
import { isHostedLockedOut } from "@/lib/entitlements";
import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";
import { enforceStorageCap } from "@/lib/hosted/billing/storage-cap";
import { sendNewRecordingBarkNotification } from "@/lib/notifications/bark";
import { sendNewRecordingEmail } from "@/lib/notifications/email";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import {
    findInlineContent,
    isReady,
    parseSummary,
    parseTranscript,
    selectContentItems,
} from "@/lib/plaud/content";
import {
    captureServerEvent,
    captureServerException,
} from "@/lib/posthog-server";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    upsertEnhancement,
    upsertTranscription,
} from "@/lib/transcription/persist";
import {
    type FiletagSyncState,
    syncFiletagsForUser,
} from "@/lib/sync/sync-filetags";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";
import type { PlaudRecording } from "@/types/plaud";

const SYNC_CONFIG = {
    PAGE_SIZE: 50,
    BATCH_CONCURRENCY: 5,
    MAX_PAGES: 20,
} as const;

interface SyncResult {
    newRecordings: number;
    updatedRecordings: number;
    errors: string[];
    pendingTranscriptionIds: string[];
    /**
     * Set when sync ended at one of the expected-state early returns
     * (no connection yet, suspended, hosted lockout) rather than an
     * operational failure. `errors` still carries the user-facing
     * message for the client, but these aren't bugs -- the caller uses
     * this to skip exception capture for them.
     */
    skipped?: "no_connection" | "suspended" | "locked_out";
    /** True when this call coalesced into an already-running in-process sync. */
    inProgress?: boolean;
    /**
     * True when Plaud rejected the stored token (HTTP 401) during this sync,
     * so the user must reconnect. Surfaced to the client so the dashboard can
     * show a reconnect banner.
     */
    needsReconnect?: boolean;
}

// Per-user in-flight dedup within one process. Cross-process correctness
// is enforced by `enforcePlaudSyncRateLimit` at the route boundary.
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

interface SyncContext {
    userId: string;
    autoTranscribe: boolean;
    /** Master opt-in: import Plaud's native transcript/summary on sync (#204). */
    importPlaudContent: boolean;
    /** 'plaud_only' (default) | 'keep_both' — see runSyncRecordingsForUser. */
    transcriptMode: string;
    emailNotifications: boolean;
    barkNotifications: boolean;
    notificationEmail: string | null;
    barkPushUrl: string | null;
    filetags: FiletagSyncState;
}

/** A freshly-synced recording that Plaud may hold transcript/summary content
 * for. Collected during the sync loop and drained by the import pass. */
interface ImportCandidate {
    recordingId: string;
    plaudFileId: string;
    isTrans: boolean;
    isSummary: boolean;
}

/** A freshly-synced recording that Plaud may hold transcript/summary content
 * for. Collected during the sync loop and drained by the import pass. */
interface ImportCandidate {
    recordingId: string;
    plaudFileId: string;
    isTrans: boolean;
    isSummary: boolean;
}

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
    return `${userId}/${plaudFileId}.${ext}`;
}

/**
 * Build an import candidate for a freshly-synced recording, or `undefined`
 * when there's nothing to import — the recording is trashed, or Plaud reports
 * neither a transcript (`is_trans`) nor a summary (`is_summary`).
 */
function buildImportCandidate(
    recordingId: string,
    plaudRecording: PlaudRecording,
): ImportCandidate | undefined {
    if (plaudRecording.is_trash) return undefined;
    if (!plaudRecording.is_trans && !plaudRecording.is_summary) {
        return undefined;
    }
    return {
        recordingId,
        plaudFileId: plaudRecording.id,
        isTrans: plaudRecording.is_trans,
        isSummary: plaudRecording.is_summary,
    };
}

/**
 * Mutable per-sync-run flag. Once a new recording is blocked by the
 * storage cap, every subsequent new recording in the same run is skipped
 * without re-querying the user's byte total (new recordings only grow
 * storage, so once over cap it stays over within the run).
 */
interface CapState {
    blocked: boolean;
}

async function processRecording(
    plaudRecording: PlaudRecording,
    context: SyncContext,
    plaudClient: Awaited<ReturnType<typeof createPlaudClient>>,
    storage: Awaited<ReturnType<typeof createUserStorageProvider>>,
    capState: CapState,
): Promise<{
    status: "new" | "updated" | "skipped" | "error";
    recordingId?: string;
    filename?: string;
    error?: string;
    importCandidate?: ImportCandidate;
    capExceeded?: boolean;
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

        const remoteTagId = plaudRecording.filetag_id_list?.[0];
        const desiredFiletagId =
            remoteTagId != null
                ? (context.filetags.map.get(String(remoteTagId)) ?? null)
                : null;

        if (
            existingRecording &&
            existingRecording.plaudVersion === versionKey
        ) {
            // Folder moves in the official app don't bump version_ms, so
            // reconcile the directory assignment even when the version is
            // unchanged.
            const currentIsLocalOnly =
                existingRecording.filetagId !== null &&
                context.filetags.localOnlyTagIds.has(
                    existingRecording.filetagId,
                );
            if (
                !existingRecording.deletedAt &&
                !currentIsLocalOnly &&
                existingRecording.filetagId !== desiredFiletagId
            ) {
                await db
                    .update(recordings)
                    .set({
                        filetagId: desiredFiletagId,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(recordings.id, existingRecording.id),
                            eq(recordings.userId, context.userId),
                        ),
                    );
                await emitEvent(
                    "recording.updated",
                    context.userId,
                    existingRecording.id,
                );
            }
            return { status: "skipped" };
        }

        // Tombstone: suppress resurrection of user-deleted recordings (#56).
        if (existingRecording?.deletedAt) {
            return { status: "skipped" };
        }

        // Storage cap: gate NEW recordings before spending Plaud egress.
        // Updates replace an existing blob (roughly size-neutral) and are
        // left untouched so a near-cap user can still receive edits.
        if (!existingRecording) {
            if (capState.blocked) {
                return { status: "skipped", capExceeded: true };
            }
            const cap = await enforceStorageCap({
                userId: context.userId,
                additionalBytes: plaudRecording.filesize,
            });
            if (!cap.allowed) {
                capState.blocked = true;
                return { status: "skipped", capExceeded: true };
            }
        }

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
            filetagId: desiredFiletagId,
        };

        if (existingRecording) {
            // Re-check under FOR UPDATE: a concurrent DELETE may have
            // tombstoned the row during the download/upload above.
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
                // Best-effort cleanup of the orphaned blob.
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
                importCandidate: buildImportCandidate(
                    existingRecording.id,
                    plaudRecording,
                ),
            };
        }

        const [newRecording] = await db
            .insert(recordings)
            .values(recordingData)
            .returning({ id: recordings.id });

        await emitEvent("recording.synced", context.userId, newRecording.id);

        return {
            status: "new",
            recordingId: newRecording.id,
            filename: plaudRecording.filename,
            importCandidate: buildImportCandidate(
                newRecording.id,
                plaudRecording,
            ),
        };
    } catch (error) {
        return {
            status: "error",
            error: `Failed to sync ${plaudRecording.filename}: ${error}`,
        };
    }
}

async function processBatch(
    batch: PlaudRecording[],
    context: SyncContext,
    plaudClient: Awaited<ReturnType<typeof createPlaudClient>>,
    storage: Awaited<ReturnType<typeof createUserStorageProvider>>,
    capState: CapState,
): Promise<{
    newCount: number;
    updatedCount: number;
    errors: string[];
    newRecordingIds: string[];
    newRecordingNames: string[];
    importCandidates: ImportCandidate[];
    capExceeded: boolean;
}> {
    const results = await Promise.allSettled(
        batch.map((rec) =>
            processRecording(rec, context, plaudClient, storage, capState),
        ),
    );

    let newCount = 0;
    let updatedCount = 0;
    let capExceeded = false;
    const errors: string[] = [];
    const newRecordingIds: string[] = [];
    const newRecordingNames: string[] = [];
    const importCandidates: ImportCandidate[] = [];

    for (const result of results) {
        if (result.status === "fulfilled") {
            const {
                status,
                recordingId,
                filename,
                error,
                importCandidate,
                capExceeded: ce,
            } = result.value;
            if (ce) capExceeded = true;
            if (status === "new" && recordingId) {
                newCount++;
                newRecordingIds.push(recordingId);
                if (filename) newRecordingNames.push(filename);
            } else if (status === "updated") {
                updatedCount++;
            } else if (status === "error" && error) {
                errors.push(error);
            }
            if (importCandidate) importCandidates.push(importCandidate);
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
        importCandidates,
        capExceeded,
    };
}

/** Paginated, batched sync. Coalesces concurrent same-user calls in-process. */
export async function syncRecordingsForUser(
    userId: string,
    trigger: "manual" | "background" = "manual",
): Promise<SyncResult> {
    const inFlight = inFlightSyncs.get(userId);
    if (inFlight) {
        const shared = await inFlight;
        return { ...shared, inProgress: true };
    }

    const run = runSyncRecordingsForUser(userId);
    inFlightSyncs.set(userId, run);
    try {
        const result = await run;
        // Bloat guard: only fire on syncs that actually changed something --
        // a background cron tick with zero new/updated recordings is pure
        // noise, not a usage signal.
        if (result.newRecordings > 0 || result.updatedRecordings > 0) {
            await captureServerEvent({
                distinctId: userId,
                event: "plaud_synced",
                properties: {
                    trigger,
                    new_recordings: result.newRecordings,
                    updated_recordings: result.updatedRecordings,
                },
            });
        }
        // `skipped` covers the expected-state early returns (no
        // connection yet, suspended, hosted lockout) -- not bugs, so
        // they don't get captured as exceptions even though `errors`
        // carries a message for the client.
        //
        // Deliberately do NOT join `result.errors` into the exception
        // message: per-recording failures embed the Plaud filename
        // ("Failed to sync <filename>: ...", see processRecording's catch
        // block) so callers can show a legible error in their own
        // dashboard -- but that's client-matter-sensitive content (Slice
        // 2 users are lawyers/journalists) that must never leave this
        // process into third-party telemetry. Only a count crosses that
        // boundary.
        if (result.errors.length > 0 && !result.skipped) {
            captureServerException(
                new Error(
                    `Sync completed with ${result.errors.length} error(s)`,
                ),
                {
                    source: "sync",
                    distinctId: userId,
                    trigger,
                    errorCount: result.errors.length,
                },
            );
        }
        return result;
    } finally {
        inFlightSyncs.delete(userId);
    }
}

async function runSyncRecordingsForUser(userId: string): Promise<SyncResult> {
    const result: SyncResult = {
        newRecordings: 0,
        updatedRecordings: 0,
        errors: [],
        pendingTranscriptionIds: [],
    };

    try {
        const [connection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, userId))
            .limit(1);

        if (!connection) {
            result.errors.push("No Plaud connection found");
            result.skipped = "no_connection";
            return result;
        }

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

        if (user?.suspendedAt) {
            result.errors.push("User is suspended");
            result.skipped = "suspended";
            return result;
        }

        // Hosted lockout: a lapsed account is read-only. Existing data
        // stays reachable; no new recordings are pulled until the user
        // subscribes again. No-op on self-host.
        if (await isHostedLockedOut(userId)) {
            result.errors.push(
                "Your hosted plan has lapsed. Subscribe to resume sync, or export your data.",
            );
            result.skipped = "locked_out";
            return result;
        }

        const plaudClient = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
            connection.workspaceId,
        );

        // Mirror Plaud directories first (one extra request per sync) so
        // each recording's filetag_id_list can be resolved to a local id.
        // Never fails the sync: degrades to the existing local mapping.
        const filetags = await syncFiletagsForUser(userId, plaudClient);

        const context: SyncContext = {
            userId,
            autoTranscribe: settings?.autoTranscribe ?? false,
            importPlaudContent: settings?.importPlaudContent ?? false,
            transcriptMode: settings?.transcriptMode ?? "plaud_only",
            emailNotifications: settings?.emailNotifications ?? false,
            barkNotifications: settings?.barkNotifications ?? false,
            notificationEmail:
                settings?.notificationEmail || user?.email || null,
            barkPushUrl: settings?.barkPushUrl || null,
            filetags,
        };
        const storage = await createUserStorageProvider(userId);
        const allNewRecordingNames: string[] = [];
        const importCandidates: ImportCandidate[] = [];
        const capState: CapState = { blocked: false };

        let page = 0;
        let hasMore = true;
        let consecutiveEmptyPages = 0;

        while (hasMore && page < SYNC_CONFIG.MAX_PAGES) {
            const skip = page * SYNC_CONFIG.PAGE_SIZE;
            const recordingsResponse = await plaudClient.getRecordings(
                skip,
                SYNC_CONFIG.PAGE_SIZE,
                0,
                "edit_time",
                true,
            );

            const plaudRecordings = recordingsResponse.data_file_list;

            if (plaudRecordings.length === 0) {
                break;
            }

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
                    capState,
                );

                result.newRecordings += batchResult.newCount;
                result.updatedRecordings += batchResult.updatedCount;
                result.errors.push(...batchResult.errors);
                result.pendingTranscriptionIds.push(
                    ...batchResult.newRecordingIds,
                );
                allNewRecordingNames.push(...batchResult.newRecordingNames);
                importCandidates.push(...batchResult.importCandidates);
            }

            // Once over the storage cap, every further new recording is a
            // no-op; stop paginating to save Plaud API calls.
            if (capState.blocked) {
                hasMore = false;
            } else if (plaudRecordings.length < SYNC_CONFIG.PAGE_SIZE) {
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

        if (capState.blocked) {
            result.errors.push(
                "Storage limit reached: some recordings were not synced. Upgrade or free up space to continue.",
            );
        }

        const resolvedWorkspaceId = plaudClient.workspaceId;
        const workspaceIdChanged =
            !!resolvedWorkspaceId &&
            resolvedWorkspaceId !== connection.workspaceId;
        await db
            .update(plaudConnections)
            .set({
                lastSync: new Date(),
                // A successful sync proves the token works again, so clear any
                // prior invalidation (self-heals transient 401s).
                invalidatedAt: null,
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

        // Import Plaud-native transcript/summary content (#204) before
        // deciding what to auto-transcribe. Runs after all recording rows are
        // committed; never throws out of sync.
        let plaudTranscriptImported = new Set<string>();
        if (context.importPlaudContent && importCandidates.length > 0) {
            plaudTranscriptImported = await importPlaudContent(
                importCandidates,
                context,
                plaudClient,
                result,
            );
        }

        // Auto-transcribe with the user's own provider. 'plaud_only' skips
        // recordings that received a Plaud transcript (saves AI credits);
        // 'keep_both' runs anyway so both coexist. Recordings whose Plaud
        // transcript wasn't ready/failed fall back here naturally.
        const idsToTranscribe =
            context.transcriptMode === "keep_both"
                ? result.pendingTranscriptionIds
                : result.pendingTranscriptionIds.filter(
                      (id) => !plaudTranscriptImported.has(id),
                  );

        if (context.autoTranscribe && idsToTranscribe.length > 0) {
            queueTranscriptions(userId, idsToTranscribe).catch((error) => {
                console.error("Background transcription failed:", error);
            });
        }

        return result;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        // A 401 from Plaud means the stored token is no longer accepted
        // (expired ~300-day UT, a mistakenly-pasted 24h workspace token that
        // has now died, or a revoked token). Mark the connection so the
        // dashboard can prompt a reconnect instead of silently failing every
        // sync. The row and synced recordings are preserved.
        if (
            error instanceof AppError &&
            error.code === ErrorCode.PLAUD_INVALID_TOKEN
        ) {
            result.needsReconnect = true;
            try {
                await db
                    .update(plaudConnections)
                    .set({ invalidatedAt: new Date() })
                    .where(eq(plaudConnections.userId, userId));
            } catch (stampError) {
                console.error(
                    "Failed to mark Plaud connection as invalidated:",
                    stampError,
                );
            }
            result.errors.push(
                "Plaud rejected the stored token. Reconnect your Plaud account.",
            );
            return result;
        }

        result.errors.push(`Sync failed: ${errorMessage}`);
        return result;
    }
}

async function queueTranscriptions(
    userId: string,
    recordingIds: string[],
): Promise<void> {
    for (const recordingId of recordingIds) {
        try {
            await transcribeRecording(userId, recordingId, { trigger: "sync" });
        } catch (error) {
            console.error(
                `Auto-transcription failed for recording ${recordingId}:`,
                error,
            );
        }
    }
}

/**
 * Import Plaud-native transcript/summary content for recordings Plaud has
 * already processed. Runs AFTER recording rows are committed and BEFORE
 * auto-transcribe, sequentially — gentle on the short-lived workspace token
 * (#203). Non-destructive: only fills gaps, never overwrites an existing
 * transcript/summary. Never throws out of sync; a dead token (401) stops the
 * pass, any other failure skips that one item.
 *
 * Returns the set of recordingIds that now hold a Plaud transcript so the
 * caller can decide (per `transcriptMode`) whether to also run the user's own
 * provider.
 */
async function importPlaudContent(
    candidates: ImportCandidate[],
    context: SyncContext,
    plaudClient: Awaited<ReturnType<typeof createPlaudClient>>,
    result: SyncResult,
): Promise<Set<string>> {
    const transcriptImported = new Set<string>();
    let tokenDead = false;

    for (const candidate of candidates) {
        if (tokenDead) break;
        try {
            const detail = await plaudClient.getFileDetail(
                candidate.plaudFileId,
            );
            const { transcript, summary } = selectContentItems(detail);

            // --- Transcript (coexists with the user's own; gap-fill only) ---
            const transcriptLink = transcript?.data_link;
            if (candidate.isTrans && isReady(transcript) && transcriptLink) {
                const [existing] = await db
                    .select({ id: transcriptions.id })
                    .from(transcriptions)
                    .where(
                        and(
                            eq(
                                transcriptions.recordingId,
                                candidate.recordingId,
                            ),
                            eq(transcriptions.userId, context.userId),
                            eq(transcriptions.source, "plaud"),
                        ),
                    )
                    .limit(1);

                if (existing) {
                    // Already imported on a prior sync. Treat as present so
                    // 'plaud_only' still suppresses re-transcription.
                    transcriptImported.add(candidate.recordingId);
                } else {
                    const parsed = parseTranscript(
                        await plaudClient.fetchContentLink(transcriptLink),
                    );
                    if (parsed.text.trim()) {
                        const { committed } = await upsertTranscription({
                            userId: context.userId,
                            recordingId: candidate.recordingId,
                            text: parsed.text,
                            detectedLanguage: parsed.language,
                            source: "plaud",
                            provider: "plaud",
                            model: "plaud-native",
                        });
                        if (committed) {
                            transcriptImported.add(candidate.recordingId);
                            await emitEvent(
                                "transcription.completed",
                                context.userId,
                                candidate.recordingId,
                            );
                        }
                    }
                }
            }

            // --- Summary (single per recording; gap-fill only) ---
            const summaryLink = summary?.data_link;
            if (candidate.isSummary && isReady(summary) && summaryLink) {
                const [existing] = await db
                    .select({ id: aiEnhancements.id })
                    .from(aiEnhancements)
                    .where(
                        and(
                            eq(
                                aiEnhancements.recordingId,
                                candidate.recordingId,
                            ),
                            eq(aiEnhancements.userId, context.userId),
                        ),
                    )
                    .limit(1);

                if (!existing) {
                    // Prefer the inline copy (no S3 round-trip, no presign
                    // expiry, #203); fall back to the presigned link.
                    const inline = findInlineContent(detail, summary?.data_id);
                    const parsed = parseSummary(
                        inline ??
                            (await plaudClient.fetchContentLink(summaryLink)),
                    );
                    if (parsed.summary.trim()) {
                        await upsertEnhancement({
                            userId: context.userId,
                            recordingId: candidate.recordingId,
                            summary: parsed.summary,
                            keyPoints: parsed.keyPoints,
                            actionItems: parsed.actionItems,
                            source: "plaud",
                            provider: "plaud",
                            model: "plaud-native",
                        });
                    }
                }
            }
        } catch (error) {
            if (
                error instanceof AppError &&
                error.code === ErrorCode.PLAUD_INVALID_TOKEN
            ) {
                // Workspace token died mid-pass (#203). Stop; audio already
                // synced and auto-transcribe remains the fallback.
                tokenDead = true;
                result.errors.push(
                    "Plaud content import stopped: access token expired",
                );
            } else {
                result.errors.push(
                    `Plaud content import failed for ${candidate.plaudFileId}: ${error}`,
                );
            }
        }
    }

    return transcriptImported;
}
