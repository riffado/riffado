import {
    type Entitlements,
    entitlementsForPlan,
    type PlanId,
} from "@/lib/entitlements";
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
 * Founding pricing is capacity-based now, not date-window-based. Keep this
 * helper as a closed legacy guard for old call sites/tests during rollout.
 */
export function isWithinFoundingWindow(_now = new Date()): boolean {
    return false;
}
