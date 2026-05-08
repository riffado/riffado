/**
 * One-shot backfill: encrypt user content rows that were written before the
 * at-rest encryption rollout. Idempotent — rows already in the current
 * ciphertext format are skipped, so it is safe to run repeatedly and to
 * interrupt mid-run.
 *
 * Scope (matches the rollout plan):
 *   - recordings.filename                     (text)
 *   - transcriptions.text                     (text)
 *   - ai_enhancements.summary                 (text)
 *   - ai_enhancements.action_items            (jsonb \u2192 envelope)
 *   - ai_enhancements.key_points              (jsonb \u2192 envelope)
 *   - user_settings.summary_prompt            (jsonb \u2192 envelope)
 *   - user_settings.title_generation_prompt   (jsonb \u2192 envelope)
 *
 * Usage:
 *   bun scripts/encrypt-backfill.ts            # apply
 *   bun scripts/encrypt-backfill.ts --dry-run  # report only
 *
 * Hosted rollout: deploy code first (writes new = encrypted, reads tolerate
 * both), run --dry-run, eyeball counts, then run for real.
 */

import { asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
    aiEnhancements,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import {
    encryptJsonField,
    encryptText,
    isEncryptedJsonField,
    isEncryptedText,
} from "@/lib/encryption/fields";

const DRY_RUN = process.argv.includes("--dry-run");
/**
 * Page size for the cursor-based fetch. We page through the table by `id`
 * (`> lastId ORDER BY id ASC LIMIT BATCH_SIZE`) so the script never holds
 * more than one batch of rows in memory at a time — important on hosted
 * Postgres where transcripts can be large and the table can be wide.
 */
const BATCH_SIZE = 500;

interface TableStats {
    table: string;
    inspected: number;
    alreadyEncrypted: number;
    encrypted: number;
    nullSkipped: number;
}

function newStats(table: string): TableStats {
    return {
        table,
        inspected: 0,
        alreadyEncrypted: 0,
        encrypted: 0,
        nullSkipped: 0,
    };
}

function logStats(s: TableStats) {
    console.log(
        `[${s.table}] inspected=${s.inspected} encrypted=${s.encrypted} ` +
            `alreadyEncrypted=${s.alreadyEncrypted} nullSkipped=${s.nullSkipped}`,
    );
}

/**
 * Generic id-cursor page iterator: fetch up to `BATCH_SIZE` rows with
 * `id > lastId ORDER BY id ASC`, yield them, advance the cursor, repeat.
 * Memory footprint is bounded by `BATCH_SIZE`, not by table size.
 *
 * Drizzle's `.select()` builders are not generic over their result row, so
 * each call site passes its own typed loader closure.
 */
async function* iterateById<R extends { id: string }>(
    fetchPage: (afterId: string | null) => Promise<R[]>,
): AsyncGenerator<R, void> {
    let cursor: string | null = null;
    while (true) {
        const page = await fetchPage(cursor);
        if (page.length === 0) return;
        for (const row of page) yield row;
        cursor = page[page.length - 1].id;
        if (page.length < BATCH_SIZE) return;
    }
}

async function backfillRecordingFilenames(): Promise<TableStats> {
    const stats = newStats("recordings.filename");
    const fetchPage = (afterId: string | null) => {
        const base = db
            .select({ id: recordings.id, filename: recordings.filename })
            .from(recordings);
        const filtered = afterId ? base.where(gt(recordings.id, afterId)) : base;
        return filtered.orderBy(asc(recordings.id)).limit(BATCH_SIZE);
    };

    for await (const row of iterateById(fetchPage)) {
        stats.inspected++;
        if (row.filename === null || row.filename === undefined) {
            stats.nullSkipped++;
            continue;
        }
        if (isEncryptedText(row.filename)) {
            stats.alreadyEncrypted++;
            continue;
        }
        if (DRY_RUN) {
            stats.encrypted++;
            continue;
        }
        await db
            .update(recordings)
            .set({ filename: encryptText(row.filename) })
            .where(eq(recordings.id, row.id));
        stats.encrypted++;
    }
    return stats;
}

async function backfillTranscriptionText(): Promise<TableStats> {
    const stats = newStats("transcriptions.text");
    const fetchPage = (afterId: string | null) => {
        const base = db
            .select({ id: transcriptions.id, text: transcriptions.text })
            .from(transcriptions);
        const filtered = afterId
            ? base.where(gt(transcriptions.id, afterId))
            : base;
        return filtered.orderBy(asc(transcriptions.id)).limit(BATCH_SIZE);
    };

    for await (const row of iterateById(fetchPage)) {
        stats.inspected++;
        if (row.text === null || row.text === undefined) {
            stats.nullSkipped++;
            continue;
        }
        if (isEncryptedText(row.text)) {
            stats.alreadyEncrypted++;
            continue;
        }
        if (DRY_RUN) {
            stats.encrypted++;
            continue;
        }
        await db
            .update(transcriptions)
            .set({ text: encryptText(row.text) })
            .where(eq(transcriptions.id, row.id));
        stats.encrypted++;
    }
    return stats;
}

async function backfillAiEnhancements(): Promise<TableStats[]> {
    const summaryStats = newStats("ai_enhancements.summary");
    const keyPointsStats = newStats("ai_enhancements.key_points");
    const actionItemsStats = newStats("ai_enhancements.action_items");

    const fetchPage = (afterId: string | null) => {
        const base = db
            .select({
                id: aiEnhancements.id,
                summary: aiEnhancements.summary,
                keyPoints: aiEnhancements.keyPoints,
                actionItems: aiEnhancements.actionItems,
            })
            .from(aiEnhancements);
        const filtered = afterId
            ? base.where(gt(aiEnhancements.id, afterId))
            : base;
        return filtered.orderBy(asc(aiEnhancements.id)).limit(BATCH_SIZE);
    };

    for await (const row of iterateById(fetchPage)) {
        const update: Record<string, unknown> = {};

        // summary (text)
        summaryStats.inspected++;
        if (row.summary === null || row.summary === undefined) {
            summaryStats.nullSkipped++;
        } else if (isEncryptedText(row.summary)) {
            summaryStats.alreadyEncrypted++;
        } else {
            summaryStats.encrypted++;
            if (!DRY_RUN) update.summary = encryptText(row.summary);
        }

        // keyPoints (jsonb)
        keyPointsStats.inspected++;
        if (row.keyPoints === null || row.keyPoints === undefined) {
            keyPointsStats.nullSkipped++;
        } else if (isEncryptedJsonField(row.keyPoints)) {
            keyPointsStats.alreadyEncrypted++;
        } else {
            keyPointsStats.encrypted++;
            if (!DRY_RUN) update.keyPoints = encryptJsonField(row.keyPoints);
        }

        // actionItems (jsonb)
        actionItemsStats.inspected++;
        if (row.actionItems === null || row.actionItems === undefined) {
            actionItemsStats.nullSkipped++;
        } else if (isEncryptedJsonField(row.actionItems)) {
            actionItemsStats.alreadyEncrypted++;
        } else {
            actionItemsStats.encrypted++;
            if (!DRY_RUN)
                update.actionItems = encryptJsonField(row.actionItems);
        }

        if (!DRY_RUN && Object.keys(update).length > 0) {
            await db
                .update(aiEnhancements)
                .set(update)
                .where(eq(aiEnhancements.id, row.id));
        }
    }
    return [summaryStats, keyPointsStats, actionItemsStats];
}

async function backfillUserSettings(): Promise<TableStats[]> {
    const summaryPromptStats = newStats("user_settings.summary_prompt");
    const titlePromptStats = newStats("user_settings.title_generation_prompt");

    const fetchPage = (afterId: string | null) => {
        const base = db
            .select({
                id: userSettings.id,
                summaryPrompt: userSettings.summaryPrompt,
                titleGenerationPrompt: userSettings.titleGenerationPrompt,
            })
            .from(userSettings);
        const filtered = afterId
            ? base.where(gt(userSettings.id, afterId))
            : base;
        return filtered.orderBy(asc(userSettings.id)).limit(BATCH_SIZE);
    };

    for await (const row of iterateById(fetchPage)) {
        const update: Record<string, unknown> = {};

        summaryPromptStats.inspected++;
        if (row.summaryPrompt === null || row.summaryPrompt === undefined) {
            summaryPromptStats.nullSkipped++;
        } else if (isEncryptedJsonField(row.summaryPrompt)) {
            summaryPromptStats.alreadyEncrypted++;
        } else {
            summaryPromptStats.encrypted++;
            if (!DRY_RUN)
                update.summaryPrompt = encryptJsonField(row.summaryPrompt);
        }

        titlePromptStats.inspected++;
        if (
            row.titleGenerationPrompt === null ||
            row.titleGenerationPrompt === undefined
        ) {
            titlePromptStats.nullSkipped++;
        } else if (isEncryptedJsonField(row.titleGenerationPrompt)) {
            titlePromptStats.alreadyEncrypted++;
        } else {
            titlePromptStats.encrypted++;
            if (!DRY_RUN)
                update.titleGenerationPrompt = encryptJsonField(
                    row.titleGenerationPrompt,
                );
        }

        if (!DRY_RUN && Object.keys(update).length > 0) {
            await db
                .update(userSettings)
                .set(update)
                .where(eq(userSettings.id, row.id));
        }
    }
    return [summaryPromptStats, titlePromptStats];
}

async function main() {
    console.log(
        DRY_RUN
            ? "encrypt-backfill: DRY RUN (no writes)"
            : "encrypt-backfill: APPLYING",
    );

    const all: TableStats[] = [];
    all.push(await backfillRecordingFilenames());
    all.push(await backfillTranscriptionText());
    all.push(...(await backfillAiEnhancements()));
    all.push(...(await backfillUserSettings()));

    console.log("\n--- summary ---");
    for (const s of all) logStats(s);

    const totalToEncrypt = all.reduce((acc, s) => acc + s.encrypted, 0);
    console.log(
        `\n${DRY_RUN ? "Would encrypt" : "Encrypted"} ${totalToEncrypt} field value(s) total.`,
    );
    process.exit(0);
}

main().catch((err) => {
    console.error("encrypt-backfill failed:", err);
    process.exit(1);
});
