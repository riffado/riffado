import {
    type Entitlements,
    entitlementsForPlan,
    type PlanId,
} from "@/lib/entitlements";
import { env } from "@/lib/env";
import { isProPriceId } from "./pricing";

interface PlanEntry {
    plan: PlanId;
    entitlements: Entitlements;
}

const FREE_ENTRY: PlanEntry = {
    plan: "hosted_free",
    entitlements: entitlementsForPlan("hosted_free"),
};

const PRO_ENTRY: PlanEntry = {
    plan: "hosted_pro",
    entitlements: entitlementsForPlan("hosted_pro"),
};

/**
 * Stripe subscription statuses that grant Pro entitlements. `past_due`
 * is included so dunning retries don't instantly demote the user --
 * our own grace machine owns the eventual lockout. Everything else
 * (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`)
 * falls back to free.
 */
const PRO_STATUSES = new Set<string>(["active", "trialing", "past_due"]);

/**
 * Map a Stripe subscription's status + price to a plan + entitlements.
 * Pro requires both an active-ish status AND one of our configured Pro
 * price ids -- an unknown price (misconfiguration) yields free
 * entitlements, never privilege escalation.
 */
export function entitlementsForSubscription(input: {
    status: string;
    priceId: string | null | undefined;
}): PlanEntry {
    if (!PRO_STATUSES.has(input.status)) return FREE_ENTRY;
    return isProPriceId(input.priceId) ? PRO_ENTRY : FREE_ENTRY;
}

/** Stripe returns period boundaries as unix seconds; convert to Date. */
export function unixToDate(seconds: number | null | undefined): Date | null {
    if (seconds === null || seconds === undefined) return null;
    return new Date(seconds * 1000);
}

/**
 * True when `BILLING_LAUNCH_DATE` is set and `now` is within
 * `BILLING_FOUNDING_MEMBER_WINDOW_DAYS` of it (default 180). Without a
 * launch date the window is closed (no accidental founding stamps).
 */
export function isWithinFoundingWindow(now = new Date()): boolean {
    const iso = env.BILLING_LAUNCH_DATE;
    if (!iso) return false;
    const launch = new Date(`${iso}T00:00:00Z`);
    const windowDays = env.BILLING_FOUNDING_MEMBER_WINDOW_DAYS ?? 180;
    const end = new Date(launch.getTime() + windowDays * 24 * 60 * 60_000);
    return now >= launch && now < end;
}
