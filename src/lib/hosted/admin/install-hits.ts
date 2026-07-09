import { and, desc, gte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { installScriptHits } from "@/db/schema";
import { env } from "@/lib/env";
import { isValidVersionTag } from "@/lib/install-script";

/**
 * Bucket a raw version segment into the value we store. We allow:
 *   - "latest" for the unversioned `/install.sh` route
 *   - "vX.Y.Z" tags that pass the existing version regex
 *   - "invalid" for everything else, so a flood of garbage paths can't
 *     blow up table cardinality
 */
function normalizeVersion(raw: string): string {
    if (raw === "latest") return "latest";
    if (isValidVersionTag(raw)) return raw;
    return "invalid";
}

/** UTC date string in `YYYY-MM-DD` form. drizzle `date` columns accept this. */
function today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Record a single hit on the install-script route. No-op on self-host
 * (only the hosted instance is a meaningful aggregator), and any DB error
 * is swallowed -- the install script must serve even if the DB is down.
 *
 * Callers MUST `await` this. Serverless runtimes can kill pending promises
 * after response flush, silently dropping increments. The upsert is
 * sub-5ms; the helper is a no-op on self-host anyway.
 */
export async function recordInstallHit(rawVersion: string): Promise<void> {
    if (!env.IS_HOSTED) return;
    try {
        const version = normalizeVersion(rawVersion);
        await db
            .insert(installScriptHits)
            .values({ day: today(), version, count: 1 })
            .onConflictDoUpdate({
                target: [installScriptHits.day, installScriptHits.version],
                set: { count: sql`${installScriptHits.count} + 1` },
            });
    } catch {
        // Intentionally silent. The install script's job is to serve;
        // a missed counter increment is not worth a 500.
    }
}

export type InstallHitStats = {
    /** Total hits across all versions in the requested window. */
    total: number;
    /** Number of distinct version buckets with at least one hit in the window. */
    distinctVersions: number;
    /** Top versions by hit count, descending, capped by caller. */
    topVersions: Array<{ version: string; count: number }>;
};

/**
 * Aggregate stats for the admin dashboard tile. Returns zeros on self-host
 * (the table will be empty there anyway).
 */
export async function getInstallHitStats(
    days: number,
    topN = 5,
): Promise<InstallHitStats> {
    if (!env.IS_HOSTED) {
        return { total: 0, distinctVersions: 0, topVersions: [] };
    }
    // `days` is inclusive of today: a 30-day window covers today plus the
    // 29 preceding UTC days = 30 distinct date buckets. Subtracting
    // `days * DAY_MS` and slicing would include 31 buckets (off-by-one).
    const since = new Date(Date.now() - (days - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);

    const rows = await db
        .select({
            version: installScriptHits.version,
            count: sum(installScriptHits.count).mapWith(Number),
        })
        .from(installScriptHits)
        .where(and(gte(installScriptHits.day, since)))
        .groupBy(installScriptHits.version)
        .orderBy(desc(sum(installScriptHits.count)));

    const total = rows.reduce((acc, r) => acc + (r.count ?? 0), 0);
    const distinctVersions = rows.length;
    const topVersions = rows.slice(0, topN).map((r) => ({
        version: r.version,
        count: r.count ?? 0,
    }));

    return { total, distinctVersions, topVersions };
}
