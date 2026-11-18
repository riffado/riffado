import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    claimUsersDueForDeletion,
    deleteUser,
    listRecordingStoragePaths,
} from "@/db/queries/billing";
import { listExportStorageKeysForUser } from "@/db/queries/export-jobs";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { sendAccountDeletedEmail } from "@/lib/notifications/email";
import { deleteStorageObject } from "@/lib/storage/delete-object";
import { createStorageProvider } from "@/lib/storage/factory";

const DEFAULT_BATCH_LIMIT = 25;

export interface DeletionResult {
    /** Users hard-deleted this run. */
    deleted: number;
    /** Users where some storage deletes failed and were queued for retry. */
    storagePartial: number;
    /** Users where the deletion itself threw (counted; the batch continues). */
    errors: number;
}

/**
 * Delete a single user's stored objects (recording audio and export
 * archives), then the user row.
 *
 * Storage cleanup is best-effort per object: a failed delete does not
 * block the user-row delete. Failed keys are queued in
 * `storage_deletion_queue` in the same transaction as the user-row
 * delete, and the export worker retries them. An object that is already
 * gone counts as deleted. The DB row deletion cascades through every
 * FK-bound dependent table (recordings, transcriptions, export jobs,
 * plaud connections, etc.) so encrypted secrets at rest are removed in
 * the same statement.
 */
export async function deleteUserAccount(userId: string): Promise<{
    storageErrors: number;
}> {
    const [emailRow] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    const capturedEmail = emailRow?.email ?? null;

    const recordingPaths = await listRecordingStoragePaths(userId);
    const exportKeys = await listExportStorageKeysForUser(userId);
    const keys = [...new Set([...recordingPaths, ...exportKeys])];
    const storage = createStorageProvider();

    const failedKeys: string[] = [];
    for (const key of keys) {
        try {
            await deleteStorageObject(storage, key);
        } catch (error) {
            failedKeys.push(key);
            console.error(
                `[billing-deletion] storage deleteFile failed for user=${userId} key=${key}, queued for retry:`,
                error,
            );
        }
    }

    await deleteUser(userId, { pendingStorageKeys: failedKeys });

    if (capturedEmail) {
        const base = env.APP_URL?.replace(/\/$/, "");
        try {
            await sendAccountDeletedEmail({
                email: capturedEmail,
                signupUrl: base ? `${base}/register` : "https://riffado.com",
            });
        } catch (error) {
            console.error(
                `[billing-deletion] account-deleted email failed for user ${userId}:`,
                error,
            );
        }
    }

    return { storageErrors: failedKeys.length };
}

/**
 * Worker tick: process up to `limit` users whose deletion grace window
 * has elapsed. Each deletion is wrapped in its own try/catch so one
 * stuck user (e.g. external storage outage that throws inside the
 * provider) does not block the batch.
 */
export async function processDueAccountDeletions(options?: {
    limit?: number;
}): Promise<DeletionResult> {
    const limit = options?.limit ?? DEFAULT_BATCH_LIMIT;
    const ids = await claimUsersDueForDeletion(limit);

    let deleted = 0;
    let storagePartial = 0;
    let errors = 0;

    for (const id of ids) {
        try {
            const result = await deleteUserAccount(id);
            deleted += 1;
            if (result.storageErrors > 0) storagePartial += 1;
        } catch (error) {
            errors += 1;
            console.error(
                `[billing-deletion] failed to delete user ${id}:`,
                error,
            );
        }
    }

    return { deleted, storagePartial, errors };
}
