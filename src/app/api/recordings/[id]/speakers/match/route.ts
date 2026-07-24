import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { speakerNames, voiceProfiles } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import {
    cosineSimilarity,
    isEmbedding,
    parseEmbedding,
    SPEAKER_MATCH_THRESHOLD,
} from "@/lib/speakers/embeddings";
import {
    assertRecordingOwned,
    MAX_SPEAKERS_PER_MATCH,
    parseSpeakerLabel,
    speakerInputError,
} from "@/lib/speakers/request";
import {
    type SpeakerName,
    serializeSpeakerName,
    type VoiceProfileRow,
} from "@/types/speaker";

type IdContext = { params: Promise<{ id: string }> };

interface SpeakerEmbedding {
    speakerLabel: string;
    embedding: number[];
}

interface UnmatchedSpeaker {
    speakerLabel: string;
    /** Closest profile name, or null when the user has no usable profiles. */
    bestMatch: string | null;
    bestScore: number | null;
}

interface SkippedSpeaker {
    speakerLabel: string;
    reason: "manual";
    displayName: string;
}

function parseEmbeddingsPayload(value: unknown): SpeakerEmbedding[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(
            "embeddings must be an object keyed by speaker label, e.g. { SPEAKER_00: [...] }",
        );
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
        throw new Error("embeddings must contain at least one speaker");
    }
    if (entries.length > MAX_SPEAKERS_PER_MATCH) {
        throw new Error(
            `embeddings must contain at most ${MAX_SPEAKERS_PER_MATCH} speakers`,
        );
    }

    const seen = new Set<string>();
    return entries.map(([rawLabel, rawEmbedding]) => {
        const speakerLabel = parseSpeakerLabel(rawLabel);
        if (seen.has(speakerLabel)) {
            throw new Error(`duplicate speaker label: ${speakerLabel}`);
        }
        seen.add(speakerLabel);
        const field = `embeddings.${speakerLabel}`;
        return {
            speakerLabel,
            embedding: parseEmbedding(rawEmbedding, field),
        };
    });
}

function round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

/**
 * Match this recording's diarized speakers against the caller's voice
 * profiles and auto-name the ones that clear
 * `SPEAKER_MATCH_THRESHOLD`.
 *
 * Body: `{ embeddings: { SPEAKER_00: number[256], ... } }`.
 *
 * Rows the user named by hand (`source = 'manual'`) are reported under
 * `skipped` and never rewritten: the point of a manual name is that it
 * wins. Everything below the threshold is reported under `unmatched` with
 * its closest profile so the caller can see near-misses without anything
 * being written.
 */
export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;

    await assertRecordingOwned(id, session.user.id);

    const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;

    let inputs: SpeakerEmbedding[];
    try {
        inputs = parseEmbeddingsPayload(body?.embeddings);
    } catch (error) {
        throw speakerInputError(error);
    }

    const profiles = await db
        .select()
        .from(voiceProfiles)
        .where(eq(voiceProfiles.userId, session.user.id));

    // Skip profiles whose stored vector no longer validates instead of
    // letting cosineSimilarity's zero fallback score them.
    const comparable = profiles.filter((profile) =>
        isEmbedding(profile.embedding),
    );

    const candidates = inputs.map((input) => {
        let best: { profile: VoiceProfileRow; score: number } | null = null;
        for (const profile of comparable) {
            const score = cosineSimilarity(input.embedding, profile.embedding);
            if (!best || score > best.score) best = { profile, score };
        }
        return { speakerLabel: input.speakerLabel, best };
    });

    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
        const matched: SpeakerName[] = [];
        const unmatched: UnmatchedSpeaker[] = [];
        const skipped: SkippedSpeaker[] = [];

        for (const { speakerLabel, best } of candidates) {
            const [existing] = await tx
                .select({
                    id: speakerNames.id,
                    source: speakerNames.source,
                    displayName: speakerNames.displayName,
                })
                .from(speakerNames)
                .where(
                    and(
                        eq(speakerNames.recordingId, id),
                        eq(speakerNames.userId, session.user.id),
                        eq(speakerNames.speakerLabel, speakerLabel),
                    ),
                )
                .for("update")
                .limit(1);

            if (existing?.source === "manual") {
                skipped.push({
                    speakerLabel,
                    reason: "manual",
                    displayName: existing.displayName,
                });
                continue;
            }

            if (!best || best.score < SPEAKER_MATCH_THRESHOLD) {
                unmatched.push({
                    speakerLabel,
                    bestMatch: best?.profile.displayName ?? null,
                    bestScore: best ? round(best.score) : null,
                });
                continue;
            }

            const { profile, score } = best;
            const values = {
                displayName: profile.displayName,
                voiceProfileId: profile.id,
                source: "auto",
                confidence: round(score),
                updatedAt: now,
            };

            if (existing) {
                // The `source <> 'manual'` predicate repeats the check
                // above at the write itself, so the row cannot be
                // clobbered by a rename that lands mid-transaction.
                const [row] = await tx
                    .update(speakerNames)
                    .set(values)
                    .where(
                        and(
                            eq(speakerNames.id, existing.id),
                            eq(speakerNames.userId, session.user.id),
                            ne(speakerNames.source, "manual"),
                        ),
                    )
                    .returning();
                if (row) {
                    matched.push(serializeSpeakerName(row));
                } else {
                    skipped.push({
                        speakerLabel,
                        reason: "manual",
                        displayName: existing.displayName,
                    });
                }
                continue;
            }

            const [row] = await tx
                .insert(speakerNames)
                .values({
                    ...values,
                    userId: session.user.id,
                    recordingId: id,
                    speakerLabel,
                })
                .returning();
            matched.push(serializeSpeakerName(row));
        }

        return { matched, unmatched, skipped };
    });

    return NextResponse.json({
        threshold: SPEAKER_MATCH_THRESHOLD,
        profilesCompared: comparable.length,
        ...outcome,
    });
});
