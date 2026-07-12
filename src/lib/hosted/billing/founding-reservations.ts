import {
    expireFoundingMemberReservationByCheckoutSession,
    listFoundingReservationsForExpiryCheck,
} from "@/db/queries/billing";
import { mirrorCheckoutSession } from "./mirror";
import { getStripe } from "./stripe-client";

const DEFAULT_BATCH_LIMIT = 50;

export interface FoundingReservationExpiryResult {
    inspected: number;
    expired: number;
    completed: number;
    errors: number;
}

export async function reconcileExpiredFoundingReservations(options?: {
    limit?: number;
    now?: Date;
}): Promise<FoundingReservationExpiryResult> {
    const now = options?.now ?? new Date();
    const reservations = await listFoundingReservationsForExpiryCheck({
        limit: options?.limit ?? DEFAULT_BATCH_LIMIT,
        now,
    });
    const stripe = getStripe();

    let expired = 0;
    let completed = 0;
    let errors = 0;

    for (const reservation of reservations) {
        try {
            const session = await stripe.checkout.sessions.retrieve(
                reservation.stripeCheckoutSessionId,
            );
            if (session.status === "expired") {
                await expireFoundingMemberReservationByCheckoutSession(
                    session.id,
                    now,
                );
                expired += 1;
                continue;
            }
            if (session.status === "complete") {
                await mirrorCheckoutSession(session);
                completed += 1;
            }
        } catch (error) {
            errors += 1;
            console.error(
                `[billing-founding-reservations] failed to reconcile reservation ${reservation.id}:`,
                error,
            );
        }
    }

    return {
        inspected: reservations.length,
        expired,
        completed,
        errors,
    };
}
