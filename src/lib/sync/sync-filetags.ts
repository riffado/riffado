import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { plaudFiletags } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import type { PlaudClient } from "@/lib/plaud/client";
import {
    DEFAULT_FILETAG_COLOR,
    normalizeFiletagIcon,
} from "@/lib/plaud/filetag-icons";

export interface FiletagSyncState {
    /** Plaud tag id (stringified) -> local plaud_filetags.id */
    map: Map<string, string>;
    /** Local ids of local-only directories (plaudTagId IS NULL). */
    localOnlyTagIds: Set<string>;
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function normalizeColor(raw: string | undefined): string {
    if (raw && HEX_COLOR.test(raw.trim())) return raw.trim();
    return DEFAULT_FILETAG_COLOR;
}

function stateFromRows(
    rows: (typeof plaudFiletags.$inferSelect)[],
): FiletagSyncState {
    const map = new Map<string, string>();
    const localOnlyTagIds = new Set<string>();
    for (const row of rows) {
        if (row.plaudTagId) map.set(row.plaudTagId, row.id);
        else localOnlyTagIds.add(row.id);
    }
    return { map, localOnlyTagIds };
}

/**
 * Mirror the user's Plaud directories into `plaud_filetags` and return the
 * Plaud-id -> local-id mapping the recording sync needs.
 *
 * Reconciliation only touches rows with a `plaudTagId`; local-only
 * directories are invisible to it. Tags that disappeared from Plaud are
 * hard-deleted (safe: write-through deletes go through Plaud first, so a
 * missing tag really is gone) and the FK's `set null` moves their
 * recordings to Unorganized.
 *
 * Never throws: any failure (Plaud unreachable, bad payload, DB error)
 * logs and degrades to the mapping derivable from the existing local rows,
 * so a filetag hiccup can't fail the recording sync.
 */
export async function syncFiletagsForUser(
    userId: string,
    plaudClient: Pick<PlaudClient, "listFiletags">,
): Promise<FiletagSyncState> {
    let localRows: (typeof plaudFiletags.$inferSelect)[] = [];
    try {
        const rows = await db
            .select()
            .from(plaudFiletags)
            .where(eq(plaudFiletags.userId, userId));
        localRows = Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.error("[sync-filetags] failed to load local rows:", error);
        return { map: new Map(), localOnlyTagIds: new Set() };
    }

    try {
        const response = await plaudClient.listFiletags();
        if (
            response.status !== 0 ||
            !Array.isArray(response.data_filetag_list)
        ) {
            console.warn(
                `[sync-filetags] Plaud returned status ${response.status}; keeping local mirror as-is`,
            );
            return stateFromRows(localRows);
        }

        const byPlaudId = new Map(
            localRows
                .filter((row) => row.plaudTagId)
                .map((row) => [row.plaudTagId as string, row]),
        );
        const remoteIds = new Set<string>();

        for (const remote of response.data_filetag_list) {
            const plaudTagId = String(remote.id);
            if (!plaudTagId) continue;
            remoteIds.add(plaudTagId);

            const name = remote.name ?? "";
            const icon = normalizeFiletagIcon(remote.icon);
            const color = normalizeColor(remote.color);
            const existing = byPlaudId.get(plaudTagId);

            if (existing) {
                const changed =
                    decryptText(existing.name) !== name ||
                    existing.icon !== icon ||
                    existing.color !== color;
                if (changed) {
                    await db
                        .update(plaudFiletags)
                        .set({
                            name: encryptText(name),
                            icon,
                            color,
                            updatedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(plaudFiletags.id, existing.id),
                                eq(plaudFiletags.userId, userId),
                            ),
                        );
                }
            } else {
                // A concurrent sync in another process may have inserted the
                // same tag; the unique (userId, plaudTagId) makes this a
                // no-op and the row is picked up by the re-select below.
                const [inserted] = await db
                    .insert(plaudFiletags)
                    .values({
                        userId,
                        plaudTagId,
                        name: encryptText(name),
                        icon,
                        color,
                    })
                    .onConflictDoNothing()
                    .returning();
                if (inserted) {
                    byPlaudId.set(plaudTagId, inserted);
                    localRows.push(inserted);
                } else {
                    const [row] = await db
                        .select()
                        .from(plaudFiletags)
                        .where(
                            and(
                                eq(plaudFiletags.userId, userId),
                                eq(plaudFiletags.plaudTagId, plaudTagId),
                            ),
                        )
                        .limit(1);
                    if (row) {
                        byPlaudId.set(plaudTagId, row);
                        localRows.push(row);
                    }
                }
            }
        }

        for (const [plaudTagId, row] of byPlaudId) {
            if (!remoteIds.has(plaudTagId)) {
                await db
                    .delete(plaudFiletags)
                    .where(
                        and(
                            eq(plaudFiletags.id, row.id),
                            eq(plaudFiletags.userId, userId),
                        ),
                    );
                localRows = localRows.filter((r) => r.id !== row.id);
            }
        }

        return stateFromRows(localRows);
    } catch (error) {
        console.error("[sync-filetags] reconciliation failed:", error);
        return stateFromRows(localRows);
    }
}
