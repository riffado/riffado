import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { acquireFiletagWriteLock } from "@/db/queries/plaud-locks";
import { plaudFiletags } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    deleteFiletagAndReleaseRecordings,
    findFiletagByName,
    getPlaudClientForUser,
    parseFiletagBody,
    serializeFiletag,
} from "@/lib/filetags/service";

type IdContext = { params: Promise<{ id: string }> };

async function loadFiletagOr404(
    id: string,
    userId: string,
): Promise<typeof plaudFiletags.$inferSelect> {
    const [row] = await db
        .select()
        .from(plaudFiletags)
        .where(and(eq(plaudFiletags.id, id), eq(plaudFiletags.userId, userId)))
        .limit(1);
    if (!row) {
        throw new AppError(ErrorCode.NOT_FOUND, "Directory not found", 404, {
            id,
        });
    }
    return row;
}

async function updateFiletagRow(
    executor: Pick<typeof db, "update">,
    userId: string,
    id: string,
    merged: { name: string; icon: string; color: string },
): Promise<typeof plaudFiletags.$inferSelect> {
    const [updated] = await executor
        .update(plaudFiletags)
        .set({
            name: encryptText(merged.name),
            icon: merged.icon,
            color: merged.color,
            updatedAt: new Date(),
        })
        .where(and(eq(plaudFiletags.id, id), eq(plaudFiletags.userId, userId)))
        .returning();
    return updated;
}

export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));

    const row = await loadFiletagOr404(id, session.user.id);
    const parsed = parseFiletagBody(body, { requireName: false });

    if (
        parsed.name === undefined &&
        parsed.icon === undefined &&
        parsed.color === undefined
    ) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Provide at least one of: name, icon, color",
            400,
        );
    }

    // Plaud's PATCH takes the full body, so merge the partial update with
    // the current values.
    const merged = {
        name: parsed.name ?? decryptText(row.name),
        icon: parsed.icon ?? row.icon,
        color: parsed.color ?? row.color,
    };

    // Local-only rename: the duplicate-name check is read-before-write, so
    // serialise check + update behind the per-user advisory lock (same race
    // as create). Plaud-backed renames stay lock-free below: Plaud's own
    // duplicate rejection is authoritative and we never hold an advisory
    // lock across an HTTP call.
    if (row.plaudTagId === null && parsed.name !== undefined) {
        const updated = await db.transaction(async (tx) => {
            await acquireFiletagWriteLock(tx, session.user.id);
            const duplicate = await findFiletagByName(
                session.user.id,
                merged.name,
                row.id,
                tx,
            );
            if (duplicate) {
                throw new AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "A directory with this name already exists.",
                    409,
                    { id: duplicate.id },
                );
            }
            return updateFiletagRow(tx, session.user.id, row.id, merged);
        });

        return NextResponse.json({ filetag: serializeFiletag(updated) });
    }

    if (parsed.name !== undefined) {
        const duplicate = await findFiletagByName(
            session.user.id,
            merged.name,
            row.id,
        );
        if (duplicate) {
            throw new AppError(
                ErrorCode.ALREADY_EXISTS,
                "A directory with this name already exists.",
                409,
                { id: duplicate.id },
            );
        }
    }

    // Write-through: update on Plaud first, local mirror on success.
    if (row.plaudTagId) {
        const plaud = await getPlaudClientForUser(session.user.id);
        if (!plaud) {
            throw new AppError(
                ErrorCode.PLAUD_NOT_CONNECTED,
                "This directory lives on Plaud, but no Plaud account is connected.",
                409,
            );
        }
        await plaud.client.updateFiletag(row.plaudTagId, merged);
        await plaud.persistWorkspaceId();
    }

    const updated = await updateFiletagRow(db, session.user.id, row.id, merged);

    return NextResponse.json({ filetag: serializeFiletag(updated) });
});

export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const row = await loadFiletagOr404(id, session.user.id);

    // Write-through: delete on Plaud first.
    if (row.plaudTagId) {
        const plaud = await getPlaudClientForUser(session.user.id);
        if (!plaud) {
            throw new AppError(
                ErrorCode.PLAUD_NOT_CONNECTED,
                "This directory lives on Plaud, but no Plaud account is connected.",
                409,
            );
        }
        await plaud.client.deleteFiletag(row.plaudTagId);
        await plaud.persistWorkspaceId();
    }

    // Move the directory's recordings to Unorganized (updatedAt bump +
    // recording.updated) and delete the row atomically; see the helper
    // for the RETURNING/soft-delete rationale.
    await deleteFiletagAndReleaseRecordings(session.user.id, row.id);

    return NextResponse.json({ success: true });
});
