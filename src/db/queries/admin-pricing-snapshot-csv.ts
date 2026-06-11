import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Per-user cost-snapshot row exposed via the admin CSV export. Schema is
 * intentionally narrow: email is the operational handle (never user_id, an
 * opaque nanoid that leaks nothing useful but is one more identifier to
 * regret), plus storage/recording/server-tx counts and lifecycle dates.
 *
 * NEVER add: filenames, transcript text, summaries, decrypted secrets,
 * bearer tokens, API keys. The bulk-PII guard in `queries-pii.test.ts`
 * watches the sibling admin.ts file; if you grow this query, add the same
 * guard here.
 */
export type PricingSnapshotCsvRow = {
    email: string;
    created_at: Date;
    suspended_at: Date | null;
    recording_count: number;
    storage_bytes: number;
    server_tx_30d: number;
};

/**
 * One round-trip: joins per-user storage rollups with 30-day server-tx
 * counts. Used by the admin pricing CSV export. Returns rows sorted by
 * `storage_bytes desc` so the operator sees the biggest cost drivers first.
 *
 * Caller is responsible for elevation (`requireAdminMutation`), audit
 * logging (`logCsvExport`), and CSV-injection escaping when serialising.
 */
export async function selectPricingSnapshotForCsvExport(): Promise<
    PricingSnapshotCsvRow[]
> {
    // `now() - interval '30 days'` runs server-side, so the window anchors
    // to the DB clock and we don't need to bind a Date param. No user
    // input flows into this query -- the only "input" is the implicit
    // 30-day constant, which is intentionally not parameterised so it
    // shows up in EXPLAIN plans verbatim and is harder to drift.
    return db.execute<PricingSnapshotCsvRow>(sql`
        with rec as (
            select user_id,
                   count(*)::int as n,
                   coalesce(sum(filesize), 0)::bigint as bytes
            from recordings
            where deleted_at is null
            group by user_id
        ),
        tx as (
            select user_id, count(*)::int as n
            from transcriptions
            where transcription_type = 'server'
              and created_at >= now() - interval '30 days'
            group by user_id
        )
        select u.email,
               u.created_at,
               u.suspended_at,
               coalesce(rec.n, 0)::int as recording_count,
               coalesce(rec.bytes, 0)::bigint as storage_bytes,
               coalesce(tx.n, 0)::int as server_tx_30d
        from users u
        left join rec on rec.user_id = u.id
        left join tx on tx.user_id = u.id
        order by storage_bytes desc nulls last
    `);
}
