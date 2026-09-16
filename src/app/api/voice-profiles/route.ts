import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { voiceProfiles } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import {
    isEmbedding,
    mergeCentroid,
    parseEmbedding,
    toStoredEmbedding,
} from "@/lib/speakers/embeddings";
import { parseDisplayName, speakerInputError } from "@/lib/speakers/request";
import { serializeVoiceProfile } from "@/types/speaker";

/**
 * List the caller's known voices. Embeddings are deliberately omitted:
 * they are several KB each and no client needs them, matching is
 * server-side.
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const rows = await db
        .select({
            id: voiceProfiles.id,
            displayName: voiceProfiles.displayName,
            sampleCount: voiceProfiles.sampleCount,
            createdAt: voiceProfiles.createdAt,
            updatedAt: voiceProfiles.updatedAt,
        })
        .from(voiceProfiles)
        .where(eq(voiceProfiles.userId, session.user.id))
        .orderBy(asc(voiceProfiles.displayName));

    return NextResponse.json({ profiles: rows.map(serializeVoiceProfile) });
});

/**
 * Create or extend a voice profile.
 *
 * Body: `{ displayName, embedding: number[256] }`.
 *
 * `displayName` is the identity: an unknown name creates a profile (201),
 * a known one folds the sample into the running centroid and bumps
 * `sampleCount` (200). The read and the write share one transaction with
 * the row locked, so two concurrent samples for the same person cannot
 * both merge against the same pre-state and lose one of the two.
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;

    let displayName: string;
    let embedding: number[];
    try {
        displayName = parseDisplayName(body?.displayName);
        embedding = parseEmbedding(body?.embedding);
    } catch (error) {
        throw speakerInputError(error);
    }

    const result = await db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(voiceProfiles)
            .where(
                and(
                    eq(voiceProfiles.userId, session.user.id),
                    eq(voiceProfiles.displayName, displayName),
                ),
            )
            .for("update")
            .limit(1);

        if (!existing) {
            const [created] = await tx
                .insert(voiceProfiles)
                .values({
                    userId: session.user.id,
                    displayName,
                    embedding: toStoredEmbedding(embedding),
                    sampleCount: 1,
                })
                .returning();
            return { profile: created, created: true };
        }

        // A stored vector that no longer validates (hand-edited row,
        // dimension change upstream) is replaced rather than merged into,
        // so one bad row cannot poison every future match.
        const storedIsUsable = isEmbedding(existing.embedding);
        const nextEmbedding = storedIsUsable
            ? mergeCentroid(existing.embedding, existing.sampleCount, embedding)
            : toStoredEmbedding(embedding);

        const [updated] = await tx
            .update(voiceProfiles)
            .set({
                embedding: nextEmbedding,
                sampleCount: storedIsUsable ? existing.sampleCount + 1 : 1,
                updatedAt: new Date(),
            })
            .where(eq(voiceProfiles.id, existing.id))
            .returning();
        return { profile: updated, created: false };
    });

    return NextResponse.json(
        { profile: serializeVoiceProfile(result.profile) },
        { status: result.created ? 201 : 200 },
    );
});
