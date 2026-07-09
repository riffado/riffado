import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";

export type PlanId = "self_host" | "hosted_free" | "hosted_pro";

export interface Entitlements {
    plan: PlanId;
    /** Storage cap in bytes. `null` = unlimited (self-host). */
    maxStorageBytes: number | null;
    /** Connected-device cap. `null` = unlimited. */
    maxDevices: number | null;
    /** Mynah transcription budget per cycle in seconds. */
    monthlyMynahSeconds: number;
    /** Capability flags carried from the prior shape; default-on everywhere today. */
    canShareRecordings: boolean;
    canUseWebhooks: boolean;
    canConfigureCustomAi: boolean;
}

const SELF_HOST: Entitlements = {
    plan: "self_host",
    maxStorageBytes: null,
    maxDevices: null,
    monthlyMynahSeconds: 0,
    canShareRecordings: true,
    canUseWebhooks: true,
    canConfigureCustomAi: true,
};

// Lockout state, not a usable tier. There is no free plan on hosted --
// users who want Riffado for free self-host. `hosted_free` is where a
// lapsed trial or a post-transition grandfathered account lands:
// read-only access to existing data, no sync / upload / transcription,
// until they subscribe or the account is deleted. All caps are zero so
// every metered path refuses, and `isHostedLockedOut` gates the rest.
const HOSTED_FREE: Entitlements = {
    plan: "hosted_free",
    maxStorageBytes: 0,
    maxDevices: 0,
    monthlyMynahSeconds: 0,
    canShareRecordings: true,
    canUseWebhooks: true,
    canConfigureCustomAi: true,
};

const HOSTED_PRO: Entitlements = {
    plan: "hosted_pro",
    maxStorageBytes: 50 * 1024 * 1024 * 1024,
    maxDevices: null,
    monthlyMynahSeconds: env.BILLING_PRO_INCLUDED_SECONDS,
    canShareRecordings: true,
    canUseWebhooks: true,
    canConfigureCustomAi: true,
};

/** Static plan → entitlements lookup. Pure; no DB. */
export function entitlementsForPlan(plan: PlanId): Entitlements {
    switch (plan) {
        case "self_host":
            return SELF_HOST;
        case "hosted_free":
            return HOSTED_FREE;
        case "hosted_pro":
            return HOSTED_PRO;
    }
}

/**
 * Resolve the capability set for a given user.
 *
 * Self-host (`!IS_HOSTED`) is always all-on, regardless of any DB state.
 * On hosted: reads `users.plan` and `users.planTransitionUntil`. While
 * the transition window is open, `hosted_free` users get `hosted_pro`
 * entitlements so caps don't bite during the 30-day grace period after
 * launch. Users with NULL `plan` (e.g. just-signed-up before the
 * cycle-close worker ran) get `hosted_free`.
 */
export async function getEntitlements(userId: string): Promise<Entitlements> {
    if (!env.IS_HOSTED) return SELF_HOST;

    const rows = await db
        .select({
            plan: users.plan,
            planTransitionUntil: users.planTransitionUntil,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    const row = rows[0];
    if (!row) return HOSTED_FREE;

    const inTransition =
        row.planTransitionUntil !== null &&
        row.planTransitionUntil > new Date();
    if (inTransition && row.plan !== "hosted_pro") {
        return HOSTED_PRO;
    }
    return entitlementsForPlan(row.plan ?? "hosted_free");
}

/**
 * True when the user is in the hosted lockout state (`hosted_free`):
 * trial lapsed or grandfather transition expired without an active
 * subscription. Locked accounts are read-only -- sync, upload, and
 * transcription refuse. Always false on self-host and for users still
 * inside their transition window (they resolve to `hosted_pro`).
 */
export async function isHostedLockedOut(userId: string): Promise<boolean> {
    const entitlements = await getEntitlements(userId);
    return entitlements.plan === "hosted_free";
}
