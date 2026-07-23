import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, plaudFiletags, recordings } from "@/db/schema";
import { decryptText } from "@/lib/encryption/fields";
import { AppError, ErrorCode } from "@/lib/errors";
import type { PlaudClient } from "@/lib/plaud/client";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import {
    DEFAULT_FILETAG_COLOR,
    DEFAULT_FILETAG_ICON,
    PLAUD_FILETAG_COLORS,
    PLAUD_FILETAG_ICON_MAP,
} from "@/lib/plaud/filetag-icons";
import { emitEvent } from "@/lib/webhooks/emit";
import type { Filetag } from "@/types/filetag";

export const MAX_FILETAG_NAME_LENGTH = 50;

export function serializeFiletag(
    row: typeof plaudFiletags.$inferSelect,
): Filetag {
    return {
        id: row.id,
        name: decryptText(row.name),
        icon: row.icon,
        color: row.color,
        isLocalOnly: row.plaudTagId === null,
    };
}

export interface ParsedFiletagBody {
    name?: string;
    icon?: string;
    color?: string;
}

/**
 * Guard a parsed JSON request body down to a plain object. `null`, arrays
 * and primitives are valid JSON but reading a property off them (e.g.
 * `body.name`) throws a TypeError → 500. Reject them as a 400 up front.
 */
export function assertJsonObjectBody(
    body: unknown,
): asserts body is Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Request body must be a JSON object",
            400,
        );
    }
}

/**
 * Validate a create/update body. `requireName` distinguishes POST (name
 * mandatory) from PATCH (any subset). Icon must be a canonical Plaud name
 * we can render; color must be one of the official 7-swatch palette.
 */
export function parseFiletagBody(
    body: unknown,
    opts: { requireName: boolean },
): ParsedFiletagBody {
    assertJsonObjectBody(body);
    const parsed: ParsedFiletagBody = {};

    if (body.name !== undefined || opts.requireName) {
        if (typeof body.name !== "string" || !body.name.trim()) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "name is required",
                400,
                { field: "name" },
            );
        }
        const name = body.name.trim();
        if (name.length > MAX_FILETAG_NAME_LENGTH) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                `name must be at most ${MAX_FILETAG_NAME_LENGTH} characters`,
                400,
                { field: "name" },
            );
        }
        parsed.name = name;
    }

    if (body.icon !== undefined) {
        if (
            typeof body.icon !== "string" ||
            !(body.icon in PLAUD_FILETAG_ICON_MAP)
        ) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "icon must be a supported Plaud folder icon name",
                400,
                { field: "icon" },
            );
        }
        parsed.icon = body.icon;
    }

    if (body.color !== undefined) {
        const color =
            typeof body.color === "string" ? body.color.toLowerCase() : "";
        if (!(PLAUD_FILETAG_COLORS as readonly string[]).includes(color)) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                `color must be one of: ${PLAUD_FILETAG_COLORS.join(", ")}`,
                400,
                { field: "color" },
            );
        }
        parsed.color = color;
    }

    return parsed;
}

export { DEFAULT_FILETAG_COLOR, DEFAULT_FILETAG_ICON };

export interface PlaudClientHandle {
    client: PlaudClient;
    /**
     * Persist a workspaceId the client resolved lazily during the request
     * (same backfill the sync does), saving a discovery round-trip on
     * future requests. No-op when unchanged.
     */
    persistWorkspaceId: () => Promise<void>;
}

/**
 * Build a PlaudClient for the user's stored connection, or null when the
 * user has no Plaud connection (local-only mode).
 */
export async function getPlaudClientForUser(
    userId: string,
): Promise<PlaudClientHandle | null> {
    const [connection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, userId))
        .limit(1);

    if (!connection) return null;

    const client = await createPlaudClient(
        connection.bearerToken,
        connection.apiBase,
        connection.workspaceId,
    );

    return {
        client,
        persistWorkspaceId: async () => {
            const resolved = client.workspaceId;
            if (!resolved || resolved === connection.workspaceId) return;
            await db
                .update(plaudConnections)
                .set({ workspaceId: resolved })
                .where(
                    and(
                        eq(plaudConnections.id, connection.id),
                        eq(plaudConnections.userId, userId),
                    ),
                );
        },
    };
}

/** Manual uploads carry an `uploaded-` plaudFileId and never exist on Plaud. */
export function isLocalOnlyRecording(recording: {
    plaudFileId: string;
}): boolean {
    return recording.plaudFileId.startsWith("uploaded-");
}

/**
 * Case-insensitive duplicate-name check against the user's directories.
 * Backstop only — Plaud's own `-2` duplicate status is authoritative for
 * Plaud-backed tags. Pass a transaction as `executor` when the check must
 * run inside an advisory-locked transaction (local-only create/rename),
 * so it sees the serialised state instead of a stale snapshot.
 */
export async function findFiletagByName(
    userId: string,
    name: string,
    excludeId?: string,
    executor: Pick<typeof db, "select"> = db,
): Promise<typeof plaudFiletags.$inferSelect | undefined> {
    const rows = await executor
        .select()
        .from(plaudFiletags)
        .where(eq(plaudFiletags.userId, userId));
    const needle = name.trim().toLowerCase();
    return rows.find(
        (row) =>
            row.id !== excludeId &&
            decryptText(row.name).trim().toLowerCase() === needle,
    );
}

/**
 * Atomically move a directory's recordings to Unorganized and delete the
 * directory row, then emit `recording.updated` for each moved recording.
 * Shared by the API delete route and the sync reconciler so both paths
 * keep identical side effects.
 *
 * The explicit UPDATE (rather than the FK's `set null`, which acts below
 * the ORM) bumps `updatedAt` for incremental consumers and drives the
 * events. Its RETURNING clause is the source of truth for which events to
 * emit: a separate pre-select could race with concurrent filetagId
 * mutations. Soft-deleted recordings are excluded and left to the FK's
 * silent `set null` — no `updatedAt` bump, no event.
 *
 * The tag row is locked FOR UPDATE first. Every path that assigns a
 * recording to a directory takes FOR KEY SHARE on the tag row for the FK
 * check, and FOR UPDATE conflicts with it, so in-flight assignments
 * either commit before the UPDATE (and are captured by RETURNING) or
 * block and fail the FK check once the tag is gone — closing the window
 * where a recording assigned between the UPDATE and the DELETE would be
 * nulled by the FK cascade with no event. A missing row means a
 * concurrent deletion already handled the side effects, so this becomes
 * a no-op instead of emitting duplicate events.
 */
export async function deleteFiletagAndReleaseRecordings(
    userId: string,
    filetagId: string,
): Promise<void> {
    const affected = await db.transaction(async (tx) => {
        const [locked] = await tx
            .select({ id: plaudFiletags.id })
            .from(plaudFiletags)
            .where(
                and(
                    eq(plaudFiletags.id, filetagId),
                    eq(plaudFiletags.userId, userId),
                ),
            )
            .for("update");
        if (!locked) return [];

        const moved = await tx
            .update(recordings)
            .set({ filetagId: null, updatedAt: new Date() })
            .where(
                and(
                    eq(recordings.userId, userId),
                    eq(recordings.filetagId, filetagId),
                    isNull(recordings.deletedAt),
                ),
            )
            .returning({ id: recordings.id });
        await tx
            .delete(plaudFiletags)
            .where(
                and(
                    eq(plaudFiletags.id, filetagId),
                    eq(plaudFiletags.userId, userId),
                ),
            );
        return moved;
    });

    for (const { id: recordingId } of affected) {
        await emitEvent("recording.updated", userId, recordingId);
    }
}
