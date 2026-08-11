import { and, count, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { acquireFiletagWriteLock } from "@/db/queries/plaud-locks";
import { plaudFiletags, recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    DEFAULT_FILETAG_COLOR,
    DEFAULT_FILETAG_ICON,
    findFiletagByName,
    getPlaudClientForUser,
    parseFiletagBody,
    serializeFiletag,
} from "@/lib/filetags/service";

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const [rows, countRows] = await Promise.all([
        db
            .select()
            .from(plaudFiletags)
            .where(eq(plaudFiletags.userId, session.user.id))
            .orderBy(plaudFiletags.createdAt),
        db
            .select({
                filetagId: recordings.filetagId,
                count: count(),
            })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .groupBy(recordings.filetagId),
    ]);

    const counts: Record<string, number> = { unorganized: 0 };
    for (const row of countRows) {
        if (row.filetagId === null) counts.unorganized = row.count;
        else counts[row.filetagId] = row.count;
    }

    return NextResponse.json({
        filetags: rows.map(serializeFiletag),
        counts,
    });
});

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = await request.json().catch(() => ({}));

    const parsed = parseFiletagBody(body, { requireName: true });
    const name = parsed.name as string;
    const icon = parsed.icon ?? DEFAULT_FILETAG_ICON;
    const color = parsed.color ?? DEFAULT_FILETAG_COLOR;

    const plaud = await getPlaudClientForUser(session.user.id);

    // Local-only: the duplicate-name check is read-before-write (encrypted
    // names rule out a unique index), so serialise check + insert behind a
    // per-user advisory lock or two concurrent creates both pass the check.
    if (!plaud) {
        const row = await db.transaction(async (tx) => {
            await acquireFiletagWriteLock(tx, session.user.id);
            const duplicate = await findFiletagByName(
                session.user.id,
                name,
                undefined,
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
            const [inserted] = await tx
                .insert(plaudFiletags)
                .values({
                    userId: session.user.id,
                    plaudTagId: null,
                    name: encryptText(name),
                    icon,
                    color,
                })
                .returning();
            return inserted;
        });

        return NextResponse.json(
            { filetag: serializeFiletag(row) },
            { status: 201 },
        );
    }

    // Plaud-backed: the local duplicate check is fast-path UX only — Plaud's
    // own duplicate rejection (status -2 → 409) plus the unique
    // (userId, plaudTagId) index are the backstops. No advisory lock here:
    // never hold one across an HTTP call to Plaud.
    const duplicate = await findFiletagByName(session.user.id, name);
    if (duplicate) {
        throw new AppError(
            ErrorCode.ALREADY_EXISTS,
            "A directory with this name already exists.",
            409,
            { id: duplicate.id },
        );
    }

    // Write-through: create on Plaud first; only persist locally on success.
    const response = await plaud.client.createFiletag({
        name,
        icon,
        color,
    });
    if (response.data_filetag?.id === undefined) {
        throw new AppError(
            ErrorCode.PLAUD_API_ERROR,
            "Plaud did not return the created directory.",
            400,
        );
    }
    const plaudTagId = String(response.data_filetag.id);
    await plaud.persistWorkspaceId();

    try {
        const [row] = await db
            .insert(plaudFiletags)
            .values({
                userId: session.user.id,
                plaudTagId,
                name: encryptText(name),
                icon,
                color,
            })
            .returning();

        return NextResponse.json(
            { filetag: serializeFiletag(row) },
            { status: 201 },
        );
    } catch (error) {
        // Unique (userId, plaudTagId): a concurrent sync already mirrored
        // the tag we just created on Plaud — return the existing row.
        const [existing] = await db
            .select()
            .from(plaudFiletags)
            .where(
                and(
                    eq(plaudFiletags.userId, session.user.id),
                    eq(plaudFiletags.plaudTagId, plaudTagId),
                ),
            )
            .limit(1);
        if (existing) {
            return NextResponse.json(
                { filetag: serializeFiletag(existing) },
                { status: 201 },
            );
        }
        throw error;
    }
});
