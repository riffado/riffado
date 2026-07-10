import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudFiletags } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
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

export const PATCH = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;

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

    const [updated] = await db
        .update(plaudFiletags)
        .set({
            name: encryptText(merged.name),
            icon: merged.icon,
            color: merged.color,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(plaudFiletags.id, row.id),
                eq(plaudFiletags.userId, session.user.id),
            ),
        )
        .returning();

    return NextResponse.json({ filetag: serializeFiletag(updated) });
});

export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    const row = await loadFiletagOr404(id, session.user.id);

    // Write-through: delete on Plaud first. The local FK's `set null`
    // moves the directory's recordings to Unorganized.
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

    await db
        .delete(plaudFiletags)
        .where(
            and(
                eq(plaudFiletags.id, row.id),
                eq(plaudFiletags.userId, session.user.id),
            ),
        );

    return NextResponse.json({ success: true });
});
