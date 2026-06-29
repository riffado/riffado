import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { encryptJsonField, encryptText } from "@/lib/encryption/fields";

/**
 * Provenance of a transcript row, orthogonal to `transcriptionType`:
 *   - 'riffado' = produced by the user's own provider (server/browser)
 *   - 'plaud'   = imported from Plaud's native transcription
 *   - 'mixed'   = user-edited combination of the above
 * A recording can hold at most one row per source (enforced by the
 * `(recordingId, userId, source)` unique), so the sources coexist. See #204.
 */
export type TranscriptSource = "riffado" | "plaud" | "mixed";

/** Summaries stay single per recording; `source` records who produced it. */
export type EnhancementSource = "riffado" | "plaud";

export interface UpsertTranscriptionArgs {
    userId: string;
    recordingId: string;
    /** Plaintext transcript; this helper encrypts it at rest. */
    text: string;
    detectedLanguage: string | null;
    source: TranscriptSource;
    provider: string;
    model: string;
    /** Where it ran. Defaults to "server"; unrelated to `source`. */
    transcriptionType?: "server" | "browser";
}

export interface UpsertEnhancementArgs {
    userId: string;
    recordingId: string;
    /** Plaintext summary; this helper encrypts it at rest. */
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    source: EnhancementSource;
    provider: string;
    model: string;
}

/**
 * Result of a tombstone-aware upsert. `committed: false` means the recording
 * was soft-deleted mid-flight and nothing was written — callers should treat
 * that as a skip (e.g. RECORDING_DELETED), not a hard error.
 */
export interface UpsertResult {
    committed: boolean;
}

const RECORDING_TOMBSTONED = Symbol("recording-tombstoned");

// Both upserts run inside a transaction that takes a row-level write lock
// (`FOR UPDATE`) on the recording and re-checks the soft-delete tombstone, so
// a concurrent DELETE can't be silently undone: either we see `deletedAt` set
// and abort, or our write commits before DELETE runs and DELETE then cleans up
// our row inside its own tx. Lifted verbatim from the transcribe + summary
// paths so all writers share one implementation. See PR #72.

/**
 * Insert-or-update the transcription row for `(recordingId, userId, source)`.
 * Source-scoped, so a Plaud-imported transcript and the user's own provider's
 * output upsert independently and coexist.
 */
export async function upsertTranscription(
    args: UpsertTranscriptionArgs,
): Promise<UpsertResult> {
    const {
        userId,
        recordingId,
        text,
        detectedLanguage,
        source,
        provider,
        model,
        transcriptionType = "server",
    } = args;

    try {
        await db.transaction(async (tx) => {
            const [stillActive] = await tx
                .select({ deletedAt: recordings.deletedAt })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                    ),
                )
                .for("update")
                .limit(1);

            if (!stillActive || stillActive.deletedAt) {
                throw RECORDING_TOMBSTONED;
            }

            const [current] = await tx
                .select({ id: transcriptions.id })
                .from(transcriptions)
                .where(
                    and(
                        eq(transcriptions.recordingId, recordingId),
                        eq(transcriptions.userId, userId),
                        eq(transcriptions.source, source),
                    ),
                )
                .limit(1);

            const encryptedText = encryptText(text);

            if (current) {
                await tx
                    .update(transcriptions)
                    .set({
                        text: encryptedText,
                        detectedLanguage,
                        transcriptionType,
                        provider,
                        model,
                        source,
                    })
                    .where(
                        and(
                            eq(transcriptions.id, current.id),
                            eq(transcriptions.userId, userId),
                        ),
                    );
            } else {
                await tx.insert(transcriptions).values({
                    recordingId,
                    userId,
                    text: encryptedText,
                    detectedLanguage,
                    transcriptionType,
                    provider,
                    model,
                    source,
                });
            }

            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                        isNull(recordings.deletedAt),
                    ),
                );
        });
    } catch (txError) {
        if (txError === RECORDING_TOMBSTONED) {
            return { committed: false };
        }
        throw txError;
    }

    return { committed: true };
}

/**
 * Insert-or-update the single AI summary row for `(recordingId, userId)`.
 * `source` records whether riffado generated it or it was imported from Plaud.
 */
export async function upsertEnhancement(
    args: UpsertEnhancementArgs,
): Promise<UpsertResult> {
    const {
        userId,
        recordingId,
        summary,
        keyPoints,
        actionItems,
        source,
        provider,
        model,
    } = args;

    try {
        await db.transaction(async (tx) => {
            const [stillActive] = await tx
                .select({ deletedAt: recordings.deletedAt })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                    ),
                )
                .for("update")
                .limit(1);

            if (!stillActive || stillActive.deletedAt) {
                throw RECORDING_TOMBSTONED;
            }

            const [existing] = await tx
                .select({ id: aiEnhancements.id })
                .from(aiEnhancements)
                .where(
                    and(
                        eq(aiEnhancements.recordingId, recordingId),
                        eq(aiEnhancements.userId, userId),
                    ),
                )
                .limit(1);

            const encryptedSummary = encryptText(summary);
            const encryptedKeyPoints = encryptJsonField(keyPoints);
            const encryptedActionItems = encryptJsonField(actionItems);

            if (existing) {
                await tx
                    .update(aiEnhancements)
                    .set({
                        summary: encryptedSummary,
                        keyPoints: encryptedKeyPoints,
                        actionItems: encryptedActionItems,
                        provider,
                        model,
                        source,
                    })
                    .where(
                        and(
                            eq(aiEnhancements.id, existing.id),
                            eq(aiEnhancements.userId, userId),
                        ),
                    );
            } else {
                await tx.insert(aiEnhancements).values({
                    recordingId,
                    userId,
                    summary: encryptedSummary,
                    keyPoints: encryptedKeyPoints,
                    actionItems: encryptedActionItems,
                    provider,
                    model,
                    source,
                });
            }

            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, recordingId),
                        eq(recordings.userId, userId),
                        isNull(recordings.deletedAt),
                    ),
                );
        });
    } catch (txError) {
        if (txError === RECORDING_TOMBSTONED) {
            return { committed: false };
        }
        throw txError;
    }

    return { committed: true };
}
