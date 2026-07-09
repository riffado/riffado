import {
    getUserStorageBytes,
    refundMynahSeconds,
    reserveMynahSeconds,
} from "@/db/queries/billing";
import { getEntitlements } from "@/lib/entitlements";

export interface StorageCheckResult {
    allowed: boolean;
    currentBytes: number;
    additionalBytes: number;
    /** `null` when the plan has no storage cap (self-host / unlimited). */
    limitBytes: number | null;
}

/**
 * Storage cap check. Returns `allowed: true` when the cap is unset
 * (self-host) or when `currentBytes + additionalBytes <= limitBytes`.
 *
 * The user's current bytes are summed at call time from live (non-
 * tombstoned) `recordings.filesize`. This is the same number the admin
 * dashboard displays, so the user-facing "you're over your cap" message
 * and the enforcement decision can never disagree.
 */
export async function canStoreMoreBytes(
    userId: string,
    additionalBytes: number,
): Promise<StorageCheckResult> {
    const entitlements = await getEntitlements(userId);
    if (entitlements.maxStorageBytes === null) {
        return {
            allowed: true,
            currentBytes: 0,
            additionalBytes,
            limitBytes: null,
        };
    }
    const currentBytes = await getUserStorageBytes(userId);
    const wouldBe = currentBytes + Math.max(0, additionalBytes);
    return {
        allowed: wouldBe <= entitlements.maxStorageBytes,
        currentBytes,
        additionalBytes,
        limitBytes: entitlements.maxStorageBytes,
    };
}

export interface MynahReservation {
    /** Pass to `releaseMynahReservation` after the work succeeds or fails. */
    userId: string;
    seconds: number;
    /** True iff seconds were successfully reserved. */
    reserved: boolean;
}

/**
 * Reserve `seconds` against the user's Mynah counter. Returns
 * `reserved: true` when the atomic CAS subtracted; `reserved: false`
 * when the counter is below the requested amount.
 *
 * Caller MUST eventually call either `commitMynahReservation` (work
 * succeeded; nothing to do, the seconds stay subtracted) or
 * `releaseMynahReservation` (work failed; seconds refunded). Forgetting
 * to release on failure is a slow leak in the user's monthly budget,
 * not a billing risk.
 */
export async function reserveMynah(input: {
    userId: string;
    seconds: number;
}): Promise<MynahReservation> {
    const reserved = await reserveMynahSeconds({
        userId: input.userId,
        seconds: input.seconds,
    });
    return {
        userId: input.userId,
        seconds: input.seconds,
        reserved,
    };
}

/** Confirm a successful Mynah call; reservation stays subtracted. */
export function commitMynahReservation(reservation: MynahReservation): void {
    void reservation;
}

/** Refund a failed Mynah call's reserved seconds. */
export async function releaseMynahReservation(
    reservation: MynahReservation,
): Promise<void> {
    if (!reservation.reserved) return;
    await refundMynahSeconds({
        userId: reservation.userId,
        seconds: reservation.seconds,
    });
}
