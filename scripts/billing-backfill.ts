/**
 * One-shot backfill: assign initial `plan` + `planTransitionUntil` to every
 * pre-launch hosted user before the billing rollout flips `BILLING_ENABLED`.
 *
 * Cohort definition (per docs/plans/2026-05-18-hosted-pro-mynah-consolidated.md):
 *   "users with at least one row in `plaud_connections` at the moment of
 *    backfill" -- i.e. real hosted users who connected a device. Signup-and-
 *    bounced accounts (no Plaud connection) are excluded; when they wake up
 *    post-launch they enter as normal Free signups with no grace window.
 *
 * Idempotent: rows that already have a non-null `plan` are skipped. Safe to
 * re-run.
 *
 * Usage:
 *   bun scripts/billing-backfill.ts --launch=2026-07-28          # apply
 *   bun scripts/billing-backfill.ts --launch=2026-07-28 --dry-run
 *
 * --launch is required and must be ISO YYYY-MM-DD. Transition window is
 * always launch_date + 30 days at 23:59:59 UTC.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { plaudConnections, users } from "@/db/schema";
import { isValidCalendarDateString } from "@/lib/date-validation";

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
        const [k, v] = arg.slice(2).split("=", 2);
        args.set(k, v ?? "true");
    }
}

const DRY_RUN = args.has("dry-run");
const LAUNCH = args.get("launch");

// `new Date("YYYY-MM-DDT...")` silently normalizes out-of-range days
// (e.g. "2026-02-30" becomes 2026-03-02) instead of rejecting them, so a
// typo'd --launch value would shift `planTransitionUntil` for every
// updated user without any error. isValidCalendarDateString checks the
// real calendar validity, not just the NaN case.
if (
    !LAUNCH ||
    !/^\d{4}-\d{2}-\d{2}$/.test(LAUNCH) ||
    !isValidCalendarDateString(LAUNCH)
) {
    console.error(
        "billing-backfill: --launch=YYYY-MM-DD is required and must be a real calendar date (e.g. --launch=2026-07-28)",
    );
    process.exit(2);
}

const launchDate = new Date(`${LAUNCH}T00:00:00.000Z`);
const transitionUntil = new Date(
    launchDate.getTime() + 30 * 86400 * 1000 + 86399 * 1000,
);

async function main(): Promise<void> {
    console.log(
        `billing-backfill: ${DRY_RUN ? "DRY RUN" : "APPLYING"}; launch=${LAUNCH}, transitionUntil=${transitionUntil.toISOString()}`,
    );

    const unverifiedExisting = await db
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                eq(users.emailVerified, false),
                lt(users.createdAt, new Date()),
            ),
        );
    console.log(
        `billing-backfill: ${unverifiedExisting.length} pre-existing user(s) have emailVerified=false (will be grandfathered to true)`,
    );
    if (!DRY_RUN && unverifiedExisting.length > 0) {
        await db
            .update(users)
            .set({ emailVerified: true, updatedAt: new Date() })
            .where(
                and(
                    eq(users.emailVerified, false),
                    lt(users.createdAt, new Date()),
                ),
            );
        console.log(
            `billing-backfill: grandfathered ${unverifiedExisting.length} user(s) to emailVerified=true`,
        );
    }

    const cohort = await db
        .selectDistinct({ userId: plaudConnections.userId })
        .from(plaudConnections)
        .innerJoin(users, eq(users.id, plaudConnections.userId))
        .where(isNull(users.plan));

    console.log(
        `billing-backfill: ${cohort.length} user(s) match cohort (have plaud_connections AND users.plan IS NULL)`,
    );

    if (DRY_RUN || cohort.length === 0) {
        process.exit(0);
    }

    const result = await db
        .update(users)
        .set({
            plan: "hosted_free",
            planTransitionUntil: transitionUntil,
            updatedAt: new Date(),
        })
        .where(
            and(
                isNull(users.plan),
                sql`${users.id} IN (SELECT DISTINCT user_id FROM plaud_connections)`,
            ),
        )
        .returning({ id: users.id });

    console.log(
        `billing-backfill: updated ${result.length} user(s) to plan=hosted_free, planTransitionUntil=${transitionUntil.toISOString()}`,
    );
    process.exit(0);
}

main().catch((err) => {
    console.error("billing-backfill failed:", err);
    process.exit(1);
});
