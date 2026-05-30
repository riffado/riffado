import {
    and,
    count,
    countDistinct,
    desc,
    eq,
    gte,
    isNotNull,
    isNull,
    lt,
    sql,
    sum,
} from "drizzle-orm";
import { db } from "@/db";
import {
    adminActionLog,
    adminAuditLog,
    aiEnhancements,
    apiCredentials,
    plaudConnections,
    recordings,
    transcriptions,
    users,
} from "@/db/schema";

// MUST NOT select: recordings.filename, transcriptions.text,
// aiEnhancements.summary/actionItems/keyPoints, plaudConnections.bearerToken,
// apiCredentials.apiKey. Aggregates and metadata only.

const DAY_MS = 86_400_000;

export async function fleetOverview() {
    const now = Date.now();
    // ISO strings cast to `timestamp` (TZ-naive, matching schema columns).
    const d7 = sql`${new Date(now - 7 * DAY_MS).toISOString()}::timestamp`;
    const d14 = sql`${new Date(now - 14 * DAY_MS).toISOString()}::timestamp`;
    const d30 = sql`${new Date(now - 30 * DAY_MS).toISOString()}::timestamp`;

    const [
        userTotal,
        signups7,
        signupsPrior7,
        signups30,
        plaudConn7,
        plaudConnPrior7,
        activeIn7,
        activeIn30,
        suspended,
        suspensions7,
        suspensionsPrior7,
        recordingTotal,
        storageBytes,
        storageByTypeRows,
        transcriptionByType,
        enhancementTotal,
        recordingsLast7,
        recordingsPrior7,
        bytesLast7,
        bytesPrior7,
        transcriptionsLast30,
        serverTx7,
        serverTxPrior7,
        serverAudioMs7,
        serverAudioMsPrior7,
        enhancements7,
        enhancementsPrior7,
        missingTxAll,
        missingTx7,
        missingTxPrior7,
    ] = await Promise.all([
        db
            .select({ n: count() })
            .from(users)
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(gte(users.createdAt, d7))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(and(gte(users.createdAt, d14), lt(users.createdAt, d7)))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(gte(users.createdAt, d30))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(plaudConnections)
            .where(gte(plaudConnections.createdAt, d7))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(plaudConnections)
            .where(
                and(
                    gte(plaudConnections.createdAt, d14),
                    lt(plaudConnections.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: countDistinct(plaudConnections.userId) })
            .from(plaudConnections)
            .where(gte(plaudConnections.lastSync, d7))
            .then((rows) => rows[0]),
        db
            .select({ n: countDistinct(plaudConnections.userId) })
            .from(plaudConnections)
            .where(gte(plaudConnections.lastSync, d30))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(isNotNull(users.suspendedAt))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(gte(users.suspendedAt, d7))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(users)
            .where(and(gte(users.suspendedAt, d14), lt(users.suspendedAt, d7)))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(recordings)
            .where(isNull(recordings.deletedAt))
            .then((rows) => rows[0]),
        db
            .select({ b: sum(recordings.filesize) })
            .from(recordings)
            .where(isNull(recordings.deletedAt))
            .then((rows) => rows[0]),
        db
            .select({
                type: recordings.storageType,
                b: sum(recordings.filesize),
            })
            .from(recordings)
            .where(isNull(recordings.deletedAt))
            .groupBy(recordings.storageType),
        db
            .select({
                type: transcriptions.transcriptionType,
                n: count(),
            })
            .from(transcriptions)
            .groupBy(transcriptions.transcriptionType),
        db
            .select({ n: count() })
            .from(aiEnhancements)
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(recordings)
            .where(
                and(
                    isNull(recordings.deletedAt),
                    gte(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(recordings)
            .where(
                and(
                    isNull(recordings.deletedAt),
                    gte(recordings.createdAt, d14),
                    lt(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ b: sum(recordings.filesize) })
            .from(recordings)
            .where(
                and(
                    isNull(recordings.deletedAt),
                    gte(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ b: sum(recordings.filesize) })
            .from(recordings)
            .where(
                and(
                    isNull(recordings.deletedAt),
                    gte(recordings.createdAt, d14),
                    lt(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.transcriptionType, "server"),
                    gte(transcriptions.createdAt, d30),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.transcriptionType, "server"),
                    gte(transcriptions.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.transcriptionType, "server"),
                    gte(transcriptions.createdAt, d14),
                    lt(transcriptions.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ ms: sum(recordings.duration) })
            .from(transcriptions)
            .innerJoin(
                recordings,
                eq(recordings.id, transcriptions.recordingId),
            )
            .where(
                and(
                    eq(transcriptions.transcriptionType, "server"),
                    gte(transcriptions.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ ms: sum(recordings.duration) })
            .from(transcriptions)
            .innerJoin(
                recordings,
                eq(recordings.id, transcriptions.recordingId),
            )
            .where(
                and(
                    eq(transcriptions.transcriptionType, "server"),
                    gte(transcriptions.createdAt, d14),
                    lt(transcriptions.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(aiEnhancements)
            .where(gte(aiEnhancements.createdAt, d7))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(aiEnhancements)
            .where(
                and(
                    gte(aiEnhancements.createdAt, d14),
                    lt(aiEnhancements.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count(recordings.id) })
            .from(recordings)
            .leftJoin(
                transcriptions,
                eq(transcriptions.recordingId, recordings.id),
            )
            .where(and(isNull(recordings.deletedAt), isNull(transcriptions.id)))
            .then((rows) => rows[0]),
        db
            .select({ n: count(recordings.id) })
            .from(recordings)
            .leftJoin(
                transcriptions,
                eq(transcriptions.recordingId, recordings.id),
            )
            .where(
                and(
                    isNull(recordings.deletedAt),
                    isNull(transcriptions.id),
                    gte(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ n: count(recordings.id) })
            .from(recordings)
            .leftJoin(
                transcriptions,
                eq(transcriptions.recordingId, recordings.id),
            )
            .where(
                and(
                    isNull(recordings.deletedAt),
                    isNull(transcriptions.id),
                    gte(recordings.createdAt, d14),
                    lt(recordings.createdAt, d7),
                ),
            )
            .then((rows) => rows[0]),
    ]);

    return {
        userTotal: userTotal?.n ?? 0,
        activeUsers7d: activeIn7?.n ?? 0,
        activeUsers30d: activeIn30?.n ?? 0,
        suspendedUsers: suspended?.n ?? 0,
        signupsLast7: signups7?.n ?? 0,
        signupsPrior7: signupsPrior7?.n ?? 0,
        signupsLast30: signups30?.n ?? 0,
        plaudConnectionsLast7: plaudConn7?.n ?? 0,
        plaudConnectionsPrior7: plaudConnPrior7?.n ?? 0,
        recordingTotal: recordingTotal?.n ?? 0,
        storageBytes: Number(storageBytes?.b ?? 0),
        bytesLast7: Number(bytesLast7?.b ?? 0),
        bytesPrior7: Number(bytesPrior7?.b ?? 0),
        recordingsLast7: recordingsLast7?.n ?? 0,
        recordingsPrior7: recordingsPrior7?.n ?? 0,
        transcriptionByType: Object.fromEntries(
            transcriptionByType.map((r) => [r.type, r.n]),
        ) as Record<string, number>,
        serverTranscriptionsLast30: transcriptionsLast30?.n ?? 0,
        serverTranscriptionsLast7: serverTx7?.n ?? 0,
        serverTranscriptionsPrior7: serverTxPrior7?.n ?? 0,
        serverAudioMsLast7: Number(serverAudioMs7?.ms ?? 0),
        serverAudioMsPrior7: Number(serverAudioMsPrior7?.ms ?? 0),
        enhancementTotal: enhancementTotal?.n ?? 0,
        enhancementsLast7: enhancements7?.n ?? 0,
        enhancementsPrior7: enhancementsPrior7?.n ?? 0,
        suspensionsLast7: suspensions7?.n ?? 0,
        suspensionsPrior7: suspensionsPrior7?.n ?? 0,
        storageByType: Object.fromEntries(
            storageByTypeRows.map((r) => [r.type, Number(r.b ?? 0)]),
        ) as Record<string, number>,
        recordingsWithoutTranscriptionTotal: missingTxAll?.n ?? 0,
        recordingsWithoutTranscriptionLast7: missingTx7?.n ?? 0,
        recordingsWithoutTranscriptionPrior7: missingTxPrior7?.n ?? 0,
    };
}

export type FleetOverview = Awaited<ReturnType<typeof fleetOverview>>;

export async function signupsByDay(days = 90) {
    const since = new Date(Date.now() - days * DAY_MS).toISOString();
    const dayExpr = sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const rows = await db
        .select({
            day: dayExpr,
            n: count(),
        })
        .from(users)
        .where(gte(users.createdAt, sql`${since}::timestamp`))
        .groupBy(dayExpr)
        .orderBy(dayExpr);
    return rows;
}

export interface UserListRow {
    id: string;
    email: string;
    createdAt: Date;
    suspendedAt: Date | null;
    lastSync: Date | null;
    plaudConnected: boolean;
    plaudRegion: string | null;
    recordingCount: number;
    storageBytes: number;
    serverTranscriptions30d: number;
    syncErrors7d: number;
}

/** Paginated user list with cost-attribution metrics. */
export async function listUsers(opts: {
    limit: number;
    offset: number;
    q?: string;
    sort?:
        | "newest"
        | "storage_desc"
        | "recordings_desc"
        | "server_tx_desc"
        | "last_sync_desc";
}): Promise<{ rows: UserListRow[]; total: number }> {
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const search = (opts.q ?? "").trim().toLowerCase();

    const sortClause = (() => {
        switch (opts.sort) {
            case "storage_desc":
                return sql`storage_bytes desc nulls last, u.created_at desc`;
            case "recordings_desc":
                return sql`recording_count desc nulls last, u.created_at desc`;
            case "server_tx_desc":
                return sql`server_tx_30d desc nulls last, u.created_at desc`;
            case "last_sync_desc":
                return sql`last_sync desc nulls last, u.created_at desc`;
            default:
                return sql`u.created_at desc`;
        }
    })();

    const whereClause = search
        ? sql`where u.email ilike ${`%${search}%`}`
        : sql``;

    const [result, totalRes] = await Promise.all([
        db.execute<{
            id: string;
            email: string;
            created_at: Date;
            suspended_at: Date | null;
            last_sync: Date | null;
            plaud_connected: boolean;
            plaud_region: string | null;
            recording_count: number;
            storage_bytes: number;
            server_tx_30d: number;
        }>(sql`
        select
            u.id,
            u.email,
            u.created_at,
            u.suspended_at,
            pc.last_sync,
            (pc.id is not null) as plaud_connected,
            pc.api_base as plaud_region,
            coalesce(r.recording_count, 0)::int as recording_count,
            coalesce(r.storage_bytes, 0)::bigint as storage_bytes,
            coalesce(t.n, 0)::int as server_tx_30d
        from users u
        left join plaud_connections pc on pc.user_id = u.id
        left join (
            select user_id,
                   count(*)::int as recording_count,
                   sum(filesize)::bigint as storage_bytes
            from recordings
            where deleted_at is null
            group by user_id
        ) r on r.user_id = u.id
        left join (
            select user_id, count(*)::int as n
            from transcriptions
            where transcription_type = 'server'
              and created_at >= ${since30}
            group by user_id
        ) t on t.user_id = u.id
        ${whereClause}
        order by ${sortClause}
        limit ${opts.limit}
        offset ${opts.offset}
    `),
        db.execute<{ n: number }>(sql`
        select count(*)::int as n
        from users u
        ${whereClause}
    `),
    ]);

    return {
        rows: result.map((r) => ({
            id: r.id,
            email: r.email,
            createdAt: new Date(r.created_at),
            suspendedAt: r.suspended_at ? new Date(r.suspended_at) : null,
            lastSync: r.last_sync ? new Date(r.last_sync) : null,
            plaudConnected: r.plaud_connected,
            plaudRegion: r.plaud_region,
            recordingCount: Number(r.recording_count),
            storageBytes: Number(r.storage_bytes),
            serverTranscriptions30d: Number(r.server_tx_30d),
            syncErrors7d: 0,
        })),
        total: Number(totalRes[0]?.n ?? 0),
    };
}

export interface UserDetail {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    plaud: {
        connected: boolean;
        apiBase: string | null;
        plaudEmail: string | null;
        lastSync: Date | null;
        // intentionally never returned: bearerToken
    };
    metrics: {
        recordingCount: number;
        storageBytes: number;
        transcriptionCount: number;
        serverTranscriptionCount: number;
        browserTranscriptionCount: number;
        enhancementCount: number;
        apiCredentialCount: number;
    };
    recentRecordings: Array<{
        id: string;
        createdAt: Date;
        startTime: Date;
        durationMs: number;
        filesize: number;
        deviceSn: string;
        storageType: string;
        deletedAt: Date | null;
    }>;
}

export async function getUserDetail(
    userId: string,
): Promise<UserDetail | null> {
    const [u] = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            createdAt: users.createdAt,
            suspendedAt: users.suspendedAt,
            suspendedReason: users.suspendedReason,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!u) return null;

    const [pc, recAgg, txByType, enhAgg, credAgg, recent] = await Promise.all([
        db
            .select({
                id: plaudConnections.id,
                apiBase: plaudConnections.apiBase,
                plaudEmail: plaudConnections.plaudEmail,
                lastSync: plaudConnections.lastSync,
            })
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, userId))
            .orderBy(desc(plaudConnections.updatedAt))
            .limit(1)
            .then((rows) => rows[0]),
        db
            .select({ n: count(), b: sum(recordings.filesize) })
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                ),
            )
            .then((rows) => rows[0]),
        db
            .select({ type: transcriptions.transcriptionType, n: count() })
            .from(transcriptions)
            .where(eq(transcriptions.userId, userId))
            .groupBy(transcriptions.transcriptionType),
        db
            .select({ n: count() })
            .from(aiEnhancements)
            .where(eq(aiEnhancements.userId, userId))
            .then((rows) => rows[0]),
        db
            .select({ n: count() })
            .from(apiCredentials)
            .where(eq(apiCredentials.userId, userId))
            .then((rows) => rows[0]),
        db
            .select({
                id: recordings.id,
                createdAt: recordings.createdAt,
                startTime: recordings.startTime,
                durationMs: recordings.duration,
                filesize: recordings.filesize,
                deviceSn: recordings.deviceSn,
                storageType: recordings.storageType,
                deletedAt: recordings.deletedAt,
            })
            .from(recordings)
            .where(eq(recordings.userId, userId))
            .orderBy(desc(recordings.startTime))
            .limit(50),
    ]);
    const txTotalServer = txByType.find((r) => r.type === "server")?.n ?? 0;
    const txTotalBrowser = txByType.find((r) => r.type === "browser")?.n ?? 0;
    const txTotal = txByType.reduce((acc, r) => acc + r.n, 0);

    return {
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: u.createdAt,
        suspendedAt: u.suspendedAt,
        suspendedReason: u.suspendedReason,
        plaud: {
            connected: !!pc,
            apiBase: pc?.apiBase ?? null,
            plaudEmail: pc?.plaudEmail ?? null,
            lastSync: pc?.lastSync ?? null,
        },
        metrics: {
            recordingCount: recAgg?.n ?? 0,
            storageBytes: Number(recAgg?.b ?? 0),
            transcriptionCount: txTotal,
            serverTranscriptionCount: txTotalServer,
            browserTranscriptionCount: txTotalBrowser,
            enhancementCount: enhAgg?.n ?? 0,
            apiCredentialCount: credAgg?.n ?? 0,
        },
        recentRecordings: recent,
    };
}

/** Per-user storage histogram (MB buckets). */
export async function storageHistogram() {
    const rows = await db.execute<{
        bucket: string;
        n: number;
    }>(sql`
        with per_user as (
            select u.id as user_id,
                   coalesce(sum(r.filesize) filter (where r.deleted_at is null), 0)::bigint as bytes
            from users u
            left join recordings r on r.user_id = u.id
            group by u.id
        )
        select bucket, count(*)::int as n
        from (
            select case
                when bytes < 100*1024*1024 then '0-100MB'
                when bytes < 1024::bigint*1024*1024 then '100MB-1GB'
                when bytes < 5::bigint*1024*1024*1024 then '1-5GB'
                else '5GB+'
            end as bucket
            from per_user
        ) t
        group by bucket
        order by case bucket
            when '0-100MB' then 1
            when '100MB-1GB' then 2
            when '1-5GB' then 3
            when '5GB+' then 4
        end
    `);
    return rows;
}

export async function topStorageUsers(limit = 50) {
    const rows = await db.execute<{
        user_id: string;
        email: string;
        recording_count: number;
        bytes: number;
    }>(sql`
        select u.id as user_id, u.email,
               count(r.id)::int as recording_count,
               coalesce(sum(r.filesize), 0)::bigint as bytes
        from users u
        left join recordings r on r.user_id = u.id and r.deleted_at is null
        group by u.id, u.email
        order by bytes desc nulls last
        limit ${limit}
    `);
    return rows;
}

export async function transcriptionByProvider() {
    return db
        .select({
            provider: transcriptions.provider,
            type: transcriptions.transcriptionType,
            n: count(),
        })
        .from(transcriptions)
        .groupBy(transcriptions.provider, transcriptions.transcriptionType)
        .orderBy(desc(count()));
}

export async function topServerTranscriptionUsers(limit = 50) {
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const rows = await db.execute<{
        user_id: string;
        email: string;
        n: number;
    }>(sql`
        select u.id as user_id, u.email, count(t.id)::int as n
        from users u
        left join transcriptions t
          on t.user_id = u.id
         and t.transcription_type = 'server'
         and t.created_at >= ${since30}
        group by u.id, u.email
        order by n desc nulls last
        limit ${limit}
    `);
    return rows;
}

/** Sync health buckets inferred from plaudConnections.lastSync age. */
export async function syncHealth() {
    const now = Date.now();
    const h1 = new Date(now - 1 * 3600_000).toISOString();
    const d1 = new Date(now - 24 * 3600_000).toISOString();
    const d7 = new Date(now - 7 * DAY_MS).toISOString();

    const buckets = await db.execute<{ bucket: string; n: number }>(sql`
        select bucket, count(*)::int as n from (
            select case
                when last_sync is null then 'never'
                when last_sync >= ${h1} then 'fresh'
                when last_sync >= ${d1} then 'stale_24h'
                when last_sync >= ${d7} then 'stale_7d'
                else 'stale_old'
            end as bucket
            from plaud_connections
        ) t
        group by bucket
    `);
    return buckets;
}

/** Per-user CDFs (storage, recordings, server-tx); sort happens in SQL. */
export async function pricingSnapshot() {
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const [storage, recordingCounts, serverTx] = await Promise.all([
        db.execute<{ bytes: number }>(sql`
            select coalesce(sum(r.filesize) filter (where r.deleted_at is null), 0)::bigint as bytes
            from users u
            left join recordings r on r.user_id = u.id
            group by u.id
            order by bytes asc
        `),
        db.execute<{ n: number }>(sql`
            select (count(r.id) filter (where r.deleted_at is null))::int as n
            from users u
            left join recordings r on r.user_id = u.id
            group by u.id
            order by n asc
        `),
        db.execute<{ n: number }>(sql`
            select count(*)::int as n
            from transcriptions
            where transcription_type = 'server'
              and created_at >= ${since30}
            group by user_id
            order by n asc
        `),
    ]);
    return {
        storageBytesPerUser: storage.map((r) => Number(r.bytes)),
        recordingsPerUser: recordingCounts.map((r) => Number(r.n)),
        serverTranscriptions30dPerUser: serverTx.map((r) => Number(r.n)),
    };
}

/** Prune read-audit rows older than `olderThanDays`. Mutation log is never pruned. */
export async function pruneAdminAuditLog(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * DAY_MS).toISOString();
    const rows = await db.execute<{ n: number }>(sql`
        with deleted as (
            delete from ${adminAuditLog}
            where ${adminAuditLog.createdAt} < ${cutoff}::timestamp
            returning 1
        )
        select count(*)::int as n from deleted
    `);
    return Number(rows[0]?.n ?? 0);
}

export { adminActionLog, adminAuditLog };
