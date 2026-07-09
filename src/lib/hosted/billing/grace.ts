import { env } from "@/lib/env";

export type GracePath = "trial" | "paid";

interface UserGraceInputs {
    /** When the user row was created. */
    createdAt: Date;
    /** First successful charge timestamp, or null if never paid. */
    everPaidAt: Date | null;
}

/**
 * Decide which grace policy applies to a user whose plan just lapsed.
 *
 * - "paid"  (BILLING_PAID_GRACE_DAYS, default 30): user has a real
 *   relationship with us -- either they paid at some point, or they
 *   joined before `BILLING_LAUNCH_DATE` (grandfathered).
 * - "trial" (BILLING_TRIAL_GRACE_DAYS, default 7): post-launch sign-up
 *   that never converted from trial to paid.
 *
 * `BILLING_LAUNCH_DATE` defaults to "no launch date set" => everyone is
 * effectively post-launch, so the grandfather branch never fires. This
 * matches dev/self-host behavior where the env is unset.
 */
export function classifyGracePath(input: UserGraceInputs): GracePath {
    if (input.everPaidAt) return "paid";
    const launchIso = env.BILLING_LAUNCH_DATE;
    if (launchIso) {
        const launch = new Date(`${launchIso}T00:00:00Z`);
        if (input.createdAt < launch) return "paid";
    }
    return "trial";
}

/** Window length (days) for a given grace path. */
export function graceDaysForPath(path: GracePath): number {
    return path === "paid"
        ? env.BILLING_PAID_GRACE_DAYS
        : env.BILLING_TRIAL_GRACE_DAYS;
}

/**
 * Compute the timestamp at which a user's account becomes eligible for
 * hard deletion, given the lapse moment (e.g. trial end, sub end).
 */
export function computeDeletionScheduledAt(input: {
    lapseAt: Date;
    path: GracePath;
}): Date {
    const days = graceDaysForPath(input.path);
    return new Date(input.lapseAt.getTime() + days * 24 * 60 * 60 * 1000);
}
