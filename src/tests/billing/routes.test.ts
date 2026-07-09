import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, checkoutMock, stripeClientMock, sessionMock } = vi.hoisted(
    () => ({
        envMock: {
            IS_HOSTED: true,
            BILLING_ENABLED: true,
            BILLING_PRO_INTERVAL: "1 month",
            BILLING_PRO_DESCRIPTION: "Riffado Hosted Pro",
        },
        checkoutMock: {
            startSubscriptionCheckout: vi.fn(),
            reactivateSubscriptionIfStillInPeriod: vi.fn(),
            cancelSubscription: vi.fn(),
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
import {
    getSubscriptionByUserId,
    getUserBillingState,
    getUserStorageBytes,
    scheduleAccountDeletion,
} from "@/db/queries/billing";
import { getEntitlements } from "@/lib/entitlements";

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
                redirectUrl: "https://app/redirect",
            }),
        );
        expect(res.status).toBe(404);
    });

    it("returns 400 when withdrawalWaiver is missing/false", async () => {
        const res = await checkoutRoute(
            makeRequest({ redirectUrl: "https://app/redirect" }),
        );
        expect(res.status).toBe(400);
    });

    it("returns 400 when redirectUrl is not a URL", async () => {
        const res = await checkoutRoute(
            makeRequest({ withdrawalWaiver: true, redirectUrl: "not a url" }),
        );
        expect(res.status).toBe(400);
    });

    it("forwards the Stripe checkout URL when checkout succeeds", async () => {
        checkoutMock.startSubscriptionCheckout.mockResolvedValue({
            checkoutUrl: "https://checkout.stripe.com/c/abc",
            sessionId: "cs_test",
        });
        const res = await checkoutRoute(
            makeRequest({
                withdrawalWaiver: true,
                redirectUrl: "https://app/redirect",
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkoutUrl).toBe("https://checkout.stripe.com/c/abc");
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
                redirectUrl: "https://app/redirect",
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
                redirectUrl: "https://app/redirect",
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

describe("POST /api/billing/delete-now", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
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

    it("returns 409 and does not schedule deletion when the account is not already in a grace period", async () => {
        (getUserBillingState as ReturnType<typeof vi.fn>).mockResolvedValue({
            plan: "hosted_pro",
            accountDeletionScheduledAt: null,
        });
        const res = await deleteNowRoute(
            new Request("https://example.com/api/billing/delete-now", {
                method: "POST",
            }),
        );
        expect(res.status).toBe(409);
        expect(scheduleAccountDeletion).not.toHaveBeenCalled();
    });

    it("schedules immediate deletion when the account is already in a grace period", async () => {
        (getUserBillingState as ReturnType<typeof vi.fn>).mockResolvedValue({
            plan: "hosted_free",
            accountDeletionScheduledAt: new Date("2026-08-01T00:00:00Z"),
        });
        const res = await deleteNowRoute(
            new Request("https://example.com/api/billing/delete-now", {
                method: "POST",
            }),
        );
        expect(res.status).toBe(200);
        expect(scheduleAccountDeletion).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1", force: true }),
        );
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

        const res = await meRoute(
            new Request("https://example.com/api/billing/me"),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.enabled).toBe(true);
        expect(body.plan).toBe("hosted_pro");
        expect(body.foundingMember).toBe(true);
        expect(body.subscription.id).toBe("sub_abc");
        expect(body.usage.storageBytes).toBe(1_000_000_000);
        expect(body.usage.monthlyMynahSecondsRemaining).toBe(40_000);
    });
});
