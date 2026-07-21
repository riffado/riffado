import { NextResponse } from "next/server";
import {
    getFoundingMemberAvailability,
    getSubscriptionByUserId,
    getUserBillingState,
    getUserStorageBytes,
} from "@/db/queries/billing";
import { requireApiSession } from "@/lib/auth-server";
import { getEntitlements } from "@/lib/entitlements";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    billingPriceCatalog,
    resolveCurrency,
    resolveMonthlyDisplayCurrency,
    resolveRequestCountry,
} from "@/lib/hosted/billing/pricing";

/**
 * Read the current user's billing snapshot: effective entitlements,
 * usage counters, and the latest subscription summary. Used by the
 * Settings → Billing section to render plan/usage and decide which
 * action button (Subscribe / Cancel) to show.
 *
 * Always returns `enabled: false` and an empty payload when billing is
 * not configured on this instance, so the UI can render the section
 * with a "billing is not enabled" placeholder rather than hard-failing.
 */
export const GET = apiHandler(async (request) => {
    const session = await requireApiSession(request);

    if (!env.IS_HOSTED || !env.BILLING_ENABLED) {
        return NextResponse.json({
            enabled: false,
            plan: "self_host",
        });
    }

    const [state, sub, entitlements, storageBytes] = await Promise.all([
        getUserBillingState(session.user.id),
        getSubscriptionByUserId(session.user.id),
        getEntitlements(session.user.id),
        getUserStorageBytes(session.user.id),
    ]);
    if (!state) {
        throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
    }

    const launchIso = env.BILLING_LAUNCH_DATE;
    const isPaidPath =
        state.everPaidAt !== null ||
        (launchIso !== undefined &&
            state.createdAt < new Date(`${launchIso}T00:00:00Z`));
    const grace =
        state.accountDeletionScheduledAt !== null
            ? {
                  deletionAt: state.accountDeletionScheduledAt.toISOString(),
                  path: isPaidPath ? "paid" : "trial",
              }
            : null;

    const foundingAvailability = await getFoundingMemberAvailability(
        env.BILLING_FOUNDING_MEMBER_CAPACITY,
    );
    const priceCatalog = billingPriceCatalog(foundingAvailability);
    // Resolved the same way checkout resolves it, so the pre-purchase price
    // estimate this user sees always matches what Stripe will actually
    // charge them -- never show a currency the settings UI picked on its own.
    //
    // Resolved separately per tier: currency availability can differ
    // between the founding/standard monthly price and the annual price
    // (e.g. annual configured in USD only while founding monthly has both),
    // so reusing one resolved value across tiers can disagree with what
    // `startSubscriptionCheckout` actually resolves for that specific tier.
    //
    // The monthly currency is resolved via `resolveMonthlyDisplayCurrency`,
    // not a plain `resolveCurrency` call keyed to this snapshot's founding
    // vs standard kind: which kind checkout actually charges is re-checked
    // atomically at submission time, so a snapshot taken here can go stale
    // if the last founding slot is claimed before the user checks out.
    const country = resolveRequestCountry((name) => request.headers.get(name));
    const activeMonthlyKind =
        foundingAvailability.remaining > 0 ? "founding" : "standard";
    const resolvedCurrency = {
        monthly: resolveMonthlyDisplayCurrency(country, activeMonthlyKind),
        annual: resolveCurrency(country, "year", "standard"),
    };

    return NextResponse.json({
        enabled: true,
        resolvedCurrency,
        plan: state.plan ?? "hosted_free",
        planTransitionUntil: state.planTransitionUntil?.toISOString() ?? null,
        foundingMember: state.foundingMember,
        foundingOfferAvailable: foundingAvailability.remaining > 0,
        grace,
        everPaidAt: state.everPaidAt?.toISOString() ?? null,
        entitlements,
        usage: {
            storageBytes,
            monthlyMynahSecondsRemaining: state.monthlyMynahSecondsRemaining,
            monthlyMynahGrantResetAt:
                state.monthlyMynahGrantResetAt?.toISOString() ?? null,
        },
        pricing: priceCatalog,
        subscription: sub
            ? {
                  id: sub.id,
                  status: sub.status,
                  nextPaymentAt: sub.nextPaymentAt?.toISOString() ?? null,
                  canceledAt: sub.canceledAt?.toISOString() ?? null,
                  amountValue: sub.amountValue,
                  amountCurrency: sub.amountCurrency,
                  interval: sub.interval,
              }
            : null,
    });
});
