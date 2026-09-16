import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { speakerNames } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    assertRecordingOwned,
    parseDisplayName,
    parseSpeakerLabel,
    speakerInputError,
} from "@/lib/speakers/request";
import { serializeSpeakerName } from "@/types/speaker";

type IdContext = { params: Promise<{ id: string }> };

/** List the human names set for this recording's diarized speakers. */
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    await assertRecordingOwned(id, session.user.id);

    const rows = await db
        .select()
        .from(speakerNames)
        .where(
            and(
                eq(speakerNames.recordingId, id),
                eq(speakerNames.userId, session.user.id),
            ),
        )
        .orderBy(asc(speakerNames.speakerLabel));

    return NextResponse.json({ speakers: rows.map(serializeSpeakerName) });
});

/**
 * Name one speaker by hand.
 *
 * Body: `{ speakerLabel, displayName }`.
 *
 * Always writes `source = 'manual'` and clears `confidence` /
 * `voiceProfileId`: a hand-typed name supersedes whatever the voice
 * matcher decided, and the match route will not touch the row again.
 */
export const PUT = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    await assertRecordingOwned(id, session.user.id);

    const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;

    let speakerLabel: string;
    let displayName: string;
    try {
        speakerLabel = parseSpeakerLabel(body?.speakerLabel);
        displayName = parseDisplayName(body?.displayName);
    } catch (error) {
        throw speakerInputError(error);
    }

    const now = new Date();
    const [row] = await db
        .insert(speakerNames)
        .values({
            userId: session.user.id,
            recordingId: id,
            speakerLabel,
            displayName,
            source: "manual",
            confidence: null,
            voiceProfileId: null,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: [speakerNames.recordingId, speakerNames.speakerLabel],
            set: {
                // userId is re-asserted so a row that somehow carries the
                // wrong owner self-heals to the verified recording owner.
                userId: session.user.id,
                displayName,
                source: "manual",
                confidence: null,
                voiceProfileId: null,
                updatedAt: now,
            },
        })
        .returning();

    return NextResponse.json({ speaker: serializeSpeakerName(row) });
});

/**
 * Clear one speaker's name via `?label=SPEAKER_00`, dropping it back to
 * the raw diarization label. Idempotent: removing a name that is not set
 * returns `{ deleted: false }` rather than a 404.
 */
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    await assertRecordingOwned(id, session.user.id);

    const label = new URL(request.url).searchParams.get("label");
    if (!label?.trim()) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Query parameter 'label' is required",
            400,
        );
    }

    const deleted = await db
        .delete(speakerNames)
        .where(
            and(
                eq(speakerNames.recordingId, id),
                eq(speakerNames.userId, session.user.id),
                eq(speakerNames.speakerLabel, label.trim()),
            ),
        )
        .returning({ id: speakerNames.id });

    return NextResponse.json({ deleted: deleted.length > 0 });
});
