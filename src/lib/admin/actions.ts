import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
    adminActionLog,
    plaudConnections,
    recordings,
    users,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * Typed admin mutation dispatcher.
 *
 * Every mutation is invoked from a request handler that already passed
 * requireAdminMutation() (= IS_HOSTED + email allowlist + IP allowlist +
 * session + elevated cookie within mutation TTL). This file is the second
 * line of defense -- it doesn't re-check identity but it DOES enforce:
 *   - reason is non-empty
 *   - target exists (where applicable)
 *   - mutation + audit insert run inside the SAME transaction so a log
 *     failure rolls the mutation back. An unaudited admin mutation is a
 *     bigger problem than a refused mutation; we choose the latter.
 *   - idempotent paths still write a `*_noop` audit row so repeated
 *     attempts (e.g. double-suspend) leave a trail.
 *
 * Each function returns a small JSON-safe result describing what changed
 * so the caller can render confirmation UI.
 *
 * Errors thrown here use AppError with codes from `@/lib/errors`; route
 * handlers wrap calls in `apiHandler` so the unified envelope is the wire
 * shape (no raw exception messages leak).
 */

interface ActionContext {
    /** May be null when the admin row was deleted between the gate and the
     * mutation (rare race; we still log via the email snapshot). */
    adminUserId: string | null;
    adminUserEmail: string;
    ip: string | null;
    reason: string;
}

function assertReason(reason: string): void {
    const trimmed = reason.trim();
    if (trimmed.length < 4) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Admin action reason is required (min 4 characters)",
            400,
            { field: "reason" },
        );
    }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeActionLog(
    tx: Tx,
    opts: {
        ctx: ActionContext;
        action: string;
        targetUserId: string | null;
        targetResourceId: string | null;
        before: unknown;
        after: unknown;
    },
) {
    await tx.insert(adminActionLog).values({
        adminUserId: opts.ctx.adminUserId,
        adminUserEmail: opts.ctx.adminUserEmail,
        action: opts.action,
        targetUserId: opts.targetUserId,
        targetResourceId: opts.targetResourceId,
        reason: opts.ctx.reason,
        before: opts.before as never,
        after: opts.after as never,
        ip: opts.ctx.ip,
    });
}

export async function suspendUser(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true; suspendedAt: Date; alreadySuspended: boolean }> {
    assertReason(ctx.reason);
    return db.transaction(async (tx) => {
        const [u] = await tx
            .select({
                id: users.id,
                email: users.email,
                suspendedAt: users.suspendedAt,
                suspendedReason: users.suspendedReason,
            })
            .from(users)
            .where(eq(users.id, targetUserId))
            .limit(1);
        if (!u) {
            throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
        }
        if (u.suspendedAt) {
            // Idempotent: keep the original timestamp + reason. Still log a
            // noop row so repeated suspend attempts have a paper trail.
            await writeActionLog(tx, {
                ctx,
                action: "suspend_user_noop",
                targetUserId,
                targetResourceId: null,
                before: {
                    suspendedAt: u.suspendedAt,
                    suspendedReason: u.suspendedReason,
                },
                after: {
                    suspendedAt: u.suspendedAt,
                    suspendedReason: u.suspendedReason,
                },
            });
            return {
                ok: true,
                suspendedAt: u.suspendedAt,
                alreadySuspended: true,
            };
        }
        const suspendedAt = new Date();
        await tx
            .update(users)
            .set({ suspendedAt, suspendedReason: ctx.reason })
            .where(eq(users.id, targetUserId));
        await writeActionLog(tx, {
            ctx,
            action: "suspend_user",
            targetUserId,
            targetResourceId: null,
            before: { suspendedAt: null, suspendedReason: null },
            after: { suspendedAt, suspendedReason: ctx.reason },
        });
        return { ok: true, suspendedAt, alreadySuspended: false };
    });
}

export async function unsuspendUser(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true }> {
    assertReason(ctx.reason);
    return db.transaction(async (tx) => {
        const [u] = await tx
            .select({
                suspendedAt: users.suspendedAt,
                suspendedReason: users.suspendedReason,
            })
            .from(users)
            .where(eq(users.id, targetUserId))
            .limit(1);
        if (!u) {
            throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
        }
        await tx
            .update(users)
            .set({ suspendedAt: null, suspendedReason: null })
            .where(eq(users.id, targetUserId));
        await writeActionLog(tx, {
            ctx,
            action: "unsuspend_user",
            targetUserId,
            targetResourceId: null,
            before: {
                suspendedAt: u.suspendedAt,
                suspendedReason: u.suspendedReason,
            },
            after: { suspendedAt: null, suspendedReason: null },
        });
        return { ok: true };
    });
}

export async function forceDisconnectPlaud(
    ctx: ActionContext,
    targetUserId: string,
): Promise<{ ok: true; deleted: number }> {
    assertReason(ctx.reason);
    return db.transaction(async (tx) => {
        // Capture every connection row (some legacy deployments allow more
        // than one per user). We log the full set in `before` so the audit
        // record is accurate even when multiple are deleted in one shot.
        const existing = await tx
            .select({
                id: plaudConnections.id,
                apiBase: plaudConnections.apiBase,
                plaudEmail: plaudConnections.plaudEmail,
                lastSync: plaudConnections.lastSync,
            })
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, targetUserId));
        if (existing.length === 0) {
            await writeActionLog(tx, {
                ctx,
                action: "force_disconnect_plaud_noop",
                targetUserId,
                targetResourceId: null,
                before: { connected: false, count: 0 },
                after: { connected: false, count: 0 },
            });
            return { ok: true, deleted: 0 };
        }
        await tx
            .delete(plaudConnections)
            .where(eq(plaudConnections.userId, targetUserId));
        await writeActionLog(tx, {
            ctx,
            action: "force_disconnect_plaud",
            targetUserId,
            targetResourceId: existing[0].id,
            before: {
                connected: true,
                count: existing.length,
                connections: existing.map((pc) => ({
                    id: pc.id,
                    apiBase: pc.apiBase,
                    plaudEmail: pc.plaudEmail,
                    lastSync: pc.lastSync,
                })),
            },
            after: { connected: false, count: 0 },
        });
        return { ok: true, deleted: existing.length };
    });
}

export async function softDeleteRecording(
    ctx: ActionContext,
    recordingId: string,
): Promise<{ ok: true }> {
    assertReason(ctx.reason);
    return db.transaction(async (tx) => {
        const [r] = await tx
            .select({
                id: recordings.id,
                userId: recordings.userId,
                filesize: recordings.filesize,
                deletedAt: recordings.deletedAt,
            })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);
        if (!r) {
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                "Recording not found or already deleted",
                404,
            );
        }
        const deletedAt = new Date();
        await tx
            .update(recordings)
            .set({ deletedAt })
            .where(eq(recordings.id, recordingId));
        await writeActionLog(tx, {
            ctx,
            action: "soft_delete_recording",
            targetUserId: r.userId,
            targetResourceId: r.id,
            before: { deletedAt: null, filesize: r.filesize },
            // Note: the audio file is NOT hard-deleted here; the regular
            // user delete flow does the storage cleanup. This admin action
            // only marks the tombstone so the row stops appearing in user
            // views and stops counting toward quota. Hard-deletion of the
            // blob is intentionally a separate, more careful action.
            after: { deletedAt },
        });
        return { ok: true };
    });
}

/**
 * For pricing-snapshot CSV export: log the export as a distinct action so
 * we have an audit trail of who took bulk PII (emails) off the system.
 */
export async function logCsvExport(
    ctx: ActionContext,
    kind: string,
    rowCount: number,
): Promise<void> {
    assertReason(ctx.reason);
    await db.transaction(async (tx) => {
        await writeActionLog(tx, {
            ctx,
            action: `csv_export_${kind}`,
            targetUserId: null,
            targetResourceId: null,
            before: null,
            after: { rowCount },
        });
    });
}
