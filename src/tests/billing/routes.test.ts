import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, checkoutMock, stripeClientMock, sessionMock } = vi.hoisted(
    () => ({
        envMock: {
            IS_HOSTED: true,
            BILLING_ENABLED: true,
            BILLING_PRO_INTERVAL: "1 month",
            BILLING_PRO_DESCRIPTION: "Riffado Hosted Pro",
            STRIPE_PRICE_ID_USD: "price_usd",
            STRIPE_PRICE_ID_EUR: "price_eur",
            STRIPE_STANDARD_PRICE_ID_USD: "price_usd_standard",
            STRIPE_STANDARD_PRICE_ID_EUR: "price_eur_standard",
            STRIPE_PRICE_ID_USD_ANNUAL: "price_usd_year",
            STRIPE_PRICE_ID_EUR_ANNUAL: "price_eur_year",
            BILLING_PRICE_USD: "5.00",
            BILLING_PRICE_EUR: "5.00",
            BILLING_STANDARD_PRICE_USD: "9.00",
            BILLING_STANDARD_PRICE_EUR: "9.00",
            BILLING_FOUNDING_MEMBER_CAPACITY: 100,
            BILLING_PRICE_USD_ANNUAL: "50.00",
            BILLING_PRICE_EUR_ANNUAL: "50.00",
            BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
        },
        checkoutMock: {
            startSubscriptionCheckout: vi.fn(),
            reactivateSubscriptionIfStillInPeriod: vi.fn(),
            cancelSubscription: vi.fn(),
            cancelSubscriptionImmediatelyForDeletion: vi.fn(),
            createBillingPortalSession: vi.fn(),
            CheckoutPreconditionError: class CheckoutPreconditionError extends Error {
                code: string;
                constructor(message: string, code: string) {
                    super(message);
                    this.code = code;
                    this.name = "CheckoutPreconditionError";
                }
            },
        },
        stripeClientMock: { isStripeConfigured: vi.fn().mockReturnValue(true) },
        sessionMock: {
            user: { id: "u1", email: "u1@example.com", name: "User One" },
        },
    }),
);

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue(sessionMock),
}));
vi.mock("@/lib/hosted/billing/checkout", () => checkoutMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => stripeClientMock);
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/db/queries/billing", () => ({
    getFoundingMemberAvailability: vi.fn(),
    getUserBillingState: vi.fn(),
    getSubscriptionByUserId: vi.fn(),
    getUserStorageBytes: vi.fn(),
    scheduleAccountDeletion: vi.fn(),
}));
vi.mock("@/lib/entitlements", () => ({
    getEntitlements: vi.fn(),
}));

import { POST as cancelRoute } from "@/app/(hosted)/api/billing/cancel/route";
import { POST as checkoutRoute } from "@/app/(hosted)/api/billing/checkout/route";
import { POST as deleteNowRoute } from "@/app/(hosted)/api/billing/delete-now/route";
import { GET as meRoute } from "@/app/(hosted)/api/billing/me/route";
import { POST as portalRoute } from "@/app/(hosted)/api/billing/portal/route";
import {
    getFoundingMemberAvailability,
    getSubscriptionByUserId,
    getUserBillingState,
    getUserStorageBytes,
    scheduleAccountDeletion,
} from "@/db/queries/billing";
import { getEntitlements } from "@/lib/entitlements";
import { VatIdVerificationError } from "@/lib/hosted/billing/vat-id";

function makeRequest(body: unknown) {
    return new Request("https://example.com/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/billing/checkout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
        stripeClientMock.isStripeConfigured.mockReturnValue(true);
    });

    it("returns 404 when BILLING_ENABLED is false", async () => {
        envMock.BILLING_ENABLED = false;
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
            }),
        );
        expect(res.status).toBe(404);
    });

    it("keeps hosted Checkout hidden on self-host instances", async () => {
        envMock.IS_HOSTED = false;

        const res = await checkoutRoute(
            makeRequest({ withdrawalWaiver: true }),
        );

        expect(res.status).toBe(404);
        expect(checkoutMock.startSubscriptionCheckout).not.toHaveBeenCalled();
    });

    it("returns 400 when withdrawalWaiver is missing/false", async () => {
        const res = await checkoutRoute(makeRequest({}));
        expect(res.status).toBe(400);
    });

    it("rejects caller-controlled return URLs", async () => {
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                redirectUrl: "https://attacker.example",
            }),
        );
        expect(res.status).toBe(400);
        expect(checkoutMock.startSubscriptionCheckout).not.toHaveBeenCalled();
    });

    it("forwards the Stripe checkout URL when checkout succeeds", async () => {
        checkoutMock.startSubscriptionCheckout.mockResolvedValue({
            checkoutUrl: "https://checkout.stripe.com/c/abc",
            sessionId: "cs_test",
        });
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkoutUrl).toBe("https://checkout.stripe.com/c/abc");
        expect(checkoutMock.startSubscriptionCheckout).toHaveBeenCalledWith(
            expect.objectContaining({ interval: "month" }),
        );
    });

    it("passes through an annual interval when requested", async () => {
        checkoutMock.startSubscriptionCheckout.mockResolvedValue({
            checkoutUrl: "https://checkout.stripe.com/c/annual",
            sessionId: "cs_test",
        });
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                interval: "year",
            }),
        );
        expect(res.status).toBe(200);
        expect(checkoutMock.startSubscriptionCheckout).toHaveBeenCalledWith(
            expect.objectContaining({ interval: "year" }),
        );
    });

    it("rejects invalid intervals", async () => {
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                interval: "week",
            }),
        );
        expect(res.status).toBe(400);
        expect(checkoutMock.startSubscriptionCheckout).not.toHaveBeenCalled();
    });

    it("forwards business identity and returns a controlled VAT verification error", async () => {
        checkoutMock.startSubscriptionCheckout.mockRejectedValue(
            new VatIdVerificationError(
                "VAT ID verification is pending",
                "vat_id_pending",
            ),
        );
        const business = { name: "Example GmbH", vatId: "DE123456789" };

        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                business,
            }),
        );

        expect(res.status).toBe(409);
        expect(checkoutMock.startSubscriptionCheckout).toHaveBeenCalledWith(
            expect.objectContaining({ business }),
        );
    });

    it("returns a controlled non-500 response when annual checkout is unavailable", async () => {
        checkoutMock.startSubscriptionCheckout.mockRejectedValue(
            new checkoutMock.CheckoutPreconditionError(
                "annual unavailable",
                "price_unavailable",
            ),
        );
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                interval: "year",
            }),
        );
        expect(res.status).toBe(409);
    });

    it("reactivates instead of charging when already_subscribed + still in paid period", async () => {
        checkoutMock.startSubscriptionCheckout.mockRejectedValue(
            new checkoutMock.CheckoutPreconditionError(
                "already subscribed",
                "already_subscribed",
            ),
        );
        checkoutMock.reactivateSubscriptionIfStillInPeriod.mockResolvedValue(
            undefined,
        );
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.reactivated).toBe(true);
        expect(
            checkoutMock.reactivateSubscriptionIfStillInPeriod,
        ).toHaveBeenCalled();
    });

    it("returns 409 on other CheckoutPreconditionError codes", async () => {
        checkoutMock.startSubscriptionCheckout.mockRejectedValue(
            new checkoutMock.CheckoutPreconditionError(
                "subscription expired",
                "subscription_expired",
            ),
        );
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
            }),
        );
        expect(res.status).toBe(409);
    });
});

describe("POST /api/billing/cancel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
        stripeClientMock.isStripeConfigured.mockReturnValue(true);
    });

    it("returns 404 when no subscription exists for the user", async () => {
        checkoutMock.cancelSubscription.mockRejectedValue(
            new checkoutMock.CheckoutPreconditionError(
                "No subscription",
                "missing_subscription",
            ),
        );
        const res = await cancelRoute(
            new Request("https://example.com/api/billing/cancel", {
                method: "POST",
            }),
        );
        expect(res.status).toBe(404);
    });

    it("returns ok on successful cancel", async () => {
        checkoutMock.cancelSubscription.mockResolvedValue(undefined);
        const res = await cancelRoute(
            new Request("https://example.com/api/billing/cancel", {
                method: "POST",
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });
});

describe("POST /api/billing/portal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
        stripeClientMock.isStripeConfigured.mockReturnValue(true);
    });

    it("rejects caller-controlled return URLs", async () => {
        const res = await portalRoute(
            new Request("https://example.com/api/billing/portal", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    returnUrl: "https://attacker.example",
                }),
            }),
        );

        expect(res.status).toBe(400);
        expect(checkoutMock.createBillingPortalSession).not.toHaveBeenCalled();
    });

    it("returns 503 when the safe Portal configuration is missing", async () => {
        checkoutMock.createBillingPortalSession.mockRejectedValue(
            new checkoutMock.CheckoutPreconditionError(
                "Billing portal is not safely configured",
                "missing_portal_configuration",
            ),
        );

        const res = await portalRoute(
            new Request("https://example.com/api/billing/portal", {
                method: "POST",
            }),
        );

        expect(res.status).toBe(503);
    });
});

describe("POST /api/billing/delete-now", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
        stripeClientMock.isStripeConfigured.mockReturnValue(true);
        checkoutMock.cancelSubscriptionImmediatelyForDeletion.mockResolvedValue(
            undefined,
        );
    });

    it("returns 404 when billing is off", async () => {
        envMock.BILLING_ENABLED = false;
        const res = await deleteNowRoute(
            new Request("https://example.com/api/billing/delete-now", {
                method: "POST",
            }),
        );
        expect(res.status).toBe(404);
    });

    it("cancels Stripe before scheduling immediate deletion", async () => {
        const res = await deleteNowRoute(
            new Request("https://example.com/api/billing/delete-now", {
                method: "POST",
            }),
        );

        expect(res.status).toBe(200);
        expect(
            checkoutMock.cancelSubscriptionImmediatelyForDeletion,
        ).toHaveBeenCalledWith("u1");
        expect(scheduleAccountDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1", force: true }),
        );
        expect(
            checkoutMock.cancelSubscriptionImmediatelyForDeletion.mock
                .invocationCallOrder[0],
        ).toBeLessThan(
            vi.mocked(scheduleAccountDeletion).mock.invocationCallOrder[0],
        );
    });

    it("preserves the account when Stripe cancellation fails", async () => {
        checkoutMock.cancelSubscriptionImmediatelyForDeletion.mockRejectedValue(
            new Error("Stripe unavailable"),
        );

        const res = await deleteNowRoute(
            new Request("https://example.com/api/billing/delete-now", {
                method: "POST",
            }),
        );

        expect(res.status).toBe(500);
        expect(scheduleAccountDeletion).not.toHaveBeenCalled();
    });
});

describe("GET /api/billing/me", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
    });

    it("returns enabled=false when billing is off (self-host-shaped response)", async () => {
        envMock.BILLING_ENABLED = false;
        const res = await meRoute(
            new Request("https://example.com/api/billing/me"),
        );
        const body = await res.json();
        expect(body.enabled).toBe(false);
        expect(body.plan).toBe("self_host");
    });

    it("returns full billing snapshot when enabled", async () => {
        (getUserBillingState as ReturnType<typeof vi.fn>).mockResolvedValue({
            plan: "hosted_pro",
            planTransitionUntil: null,
            monthlyMynahSecondsRemaining: 40_000,
            monthlyMynahGrantResetAt: new Date("2026-08-01T00:00:00Z"),
            foundingMember: true,
            everPaidAt: new Date("2026-07-01T00:00:00Z"),
            accountDeletionScheduledAt: null,
            createdAt: new Date("2026-06-15T00:00:00Z"),
        });
        (getSubscriptionByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(
            {
                id: "sub_abc",
                status: "active",
                nextPaymentAt: new Date("2026-08-01T00:00:00Z"),
                canceledAt: null,
                amountValue: "5.00",
                amountCurrency: "EUR",
                interval: "1 month",
            },
        );
        (getEntitlements as ReturnType<typeof vi.fn>).mockResolvedValue({
            plan: "hosted_pro",
            maxStorageBytes: 50 * 1024 * 1024 * 1024,
            maxDevices: null,
            monthlyMynahSeconds: 54_000,
        });
        (getUserStorageBytes as ReturnType<typeof vi.fn>).mockResolvedValue(
            1_000_000_000,
        );
        (
            getFoundingMemberAvailability as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            capacity: 100,
            claimed: 42,
            reserved: 2,
            remaining: 56,
        });

        const res = await meRoute(
            new Request("https://example.com/api/billing/me"),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.enabled).toBe(true);
        expect(body.plan).toBe("hosted_pro");
        expect(body.foundingMember).toBe(true);
        expect(body.subscription.id).toBe("sub_abc");
        expect(body.subscription.interval).toBe("1 month");
        expect(body.pricing.monthly.founding.usd).toEqual({
            currency: "usd",
            interval: "month",
            displayAmount: "5.00",
            available: true,
        });
        expect(body.pricing.monthly.standard.usd).toEqual({
            currency: "usd",
            interval: "month",
            displayAmount: "9.00",
            available: true,
        });
        expect(body.pricing.monthly.foundingAvailability).toEqual({
            capacity: 100,
            claimed: 42,
            reserved: 2,
            remaining: 56,
        });
        expect(body.pricing.annual.eur).toEqual({
            currency: "eur",
            interval: "year",
            displayAmount: "50.00",
            available: true,
        });
        expect(body.usage.storageBytes).toBe(1_000_000_000);
        expect(body.usage.monthlyMynahSecondsRemaining).toBe(40_000);
    });
});
