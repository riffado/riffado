import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, stripeMock, pricingMock, mirrorMock, envMock } =
    vi.hoisted(() => ({
        queriesMock: {
            attachFoundingMemberReservationToCheckoutSession: vi.fn(),
            createFoundingMemberReservation: vi.fn(),
            getBillingCustomerByUserId: vi.fn(),
            getFoundingMemberAvailability: vi.fn(),
            getSubscriptionByUserId: vi.fn(),
            getUserBillingState: vi.fn(),
            releaseFoundingMemberReservation: vi.fn(),
            upsertBillingCustomer: vi.fn(),
        },
        stripeMock: {
            checkout: { sessions: { create: vi.fn(), expire: vi.fn() } },
            customers: { create: vi.fn() },
            billingPortal: { sessions: { create: vi.fn() } },
        },
        pricingMock: {
            isFoundingMonthlyPriceId: vi.fn().mockReturnValue(false),
            resolvePrice: vi.fn(),
            resolveStandardMonthlyPriceForCurrency: vi
                .fn()
                .mockReturnValue({ priceId: "price_standard" }),
        },
        mirrorMock: { mirrorStripeSubscription: vi.fn() },
        envMock: {
            STRIPE_TAX_RATE_ID_EUR: undefined as string | undefined,
            STRIPE_PORTAL_CONFIGURATION_ID: undefined as string | undefined,
            BILLING_FOUNDING_MEMBER_CAPACITY: 100,
        },
    }));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/pricing", () => pricingMock);
vi.mock("@/lib/hosted/billing/mirror", () => mirrorMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => ({
    getStripe: () => stripeMock,
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    createBillingPortalSession,
    getOrCreateStripeCustomer,
    startSubscriptionCheckout,
} from "@/lib/hosted/billing/checkout";

const baseInput = {
    userId: "user_1",
    userEmail: "u@example.com",
    userName: "U",
    redirectUrl: "https://app.example/settings#billing",
    withdrawalWaiverAcceptedAt: new Date("2026-07-01T00:00:00.000Z"),
    idempotencyKey: "checkout:user_1:nonce",
};

/** Extract the subscription_data passed to checkout.sessions.create. */
function subscriptionDataFromLastCall() {
    const [params] =
        stripeMock.checkout.sessions.create.mock.calls.at(-1) ?? [];
    return (params as { subscription_data: Record<string, unknown> })
        .subscription_data;
}

describe("getOrCreateStripeCustomer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the existing mapping without calling Stripe when one already exists", async () => {
        queriesMock.getBillingCustomerByUserId.mockResolvedValue({
            stripeCustomerId: "cus_existing",
        });
        const id = await getOrCreateStripeCustomer({
            userId: "user_1",
            email: "u@example.com",
        });
        expect(id).toBe("cus_existing");
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it("creates with a stable per-user idempotency key (not a fresh nonce)", async () => {
        queriesMock.getBillingCustomerByUserId.mockResolvedValue(null);
        stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });

        await getOrCreateStripeCustomer({
            userId: "user_1",
            email: "u@example.com",
        });

        expect(stripeMock.customers.create).toHaveBeenCalledWith(
            expect.objectContaining({ email: "u@example.com" }),
            { idempotencyKey: "stripe-customer:user_1" },
        );
        expect(queriesMock.upsertBillingCustomer).toHaveBeenCalledWith({
            userId: "user_1",
            stripeCustomerId: "cus_new",
        });
    });

    it("uses the same idempotency key across repeated calls for the same user", async () => {
        queriesMock.getBillingCustomerByUserId.mockResolvedValue(null);
        stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });

        await getOrCreateStripeCustomer({
            userId: "user_1",
            email: "u@example.com",
        });
        await getOrCreateStripeCustomer({
            userId: "user_1",
            email: "u@example.com",
        });

        const keys = stripeMock.customers.create.mock.calls.map(
            (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
        );
        expect(keys[0]).toBe(keys[1]);
    });
});

describe("createBillingPortalSession", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.STRIPE_PORTAL_CONFIGURATION_ID = undefined;
        queriesMock.getBillingCustomerByUserId.mockResolvedValue({
            stripeCustomerId: "cus_1",
        });
        stripeMock.billingPortal.sessions.create.mockResolvedValue({
            url: "https://billing.stripe.com/session/test",
        });
    });

    it("refuses to use the mutable default Portal configuration", async () => {
        await expect(
            createBillingPortalSession({
                userId: "user_1",
                returnUrl: "https://app.example/settings#billing",
            }),
        ).rejects.toMatchObject({ code: "missing_portal_configuration" });
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it("pins the configured Portal with plan switching disabled by the operator", async () => {
        envMock.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_safe";

        await expect(
            createBillingPortalSession({
                userId: "user_1",
                returnUrl: "https://app.example/settings#billing",
            }),
        ).resolves.toBe("https://billing.stripe.com/session/test");
        expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
            customer: "cus_1",
            return_url: "https://app.example/settings#billing",
            configuration: "bpc_safe",
        });
    });
});

describe("startSubscriptionCheckout tax rates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.STRIPE_TAX_RATE_ID_EUR = undefined;
        queriesMock.getSubscriptionByUserId.mockResolvedValue(null);
        queriesMock.getFoundingMemberAvailability.mockResolvedValue({
            capacity: 100,
            claimed: 0,
            reserved: 0,
            remaining: 100,
        });
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            id: "fmr_1",
            expiresAt: new Date("2026-07-01T00:35:00.000Z"),
        });
        queriesMock.attachFoundingMemberReservationToCheckoutSession.mockResolvedValue(
            true,
        );
        queriesMock.getBillingCustomerByUserId.mockResolvedValue({
            stripeCustomerId: "cus_1",
        });
        stripeMock.checkout.sessions.create.mockResolvedValue({
            url: "https://checkout.stripe.com/x",
            id: "cs_1",
        });
    });

    it("defaults Checkout to the monthly interval", async () => {
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "US" });

        expect(pricingMock.resolvePrice).toHaveBeenCalledWith(
            "US",
            "month",
            "founding",
        );
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                line_items: [{ price: "price_usd", quantity: 1 }],
            }),
            expect.any(Object),
        );
    });

    it("attaches founding reservation metadata and Checkout expiration", async () => {
        const expiresAt = new Date("2026-07-01T00:35:00.000Z");
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            id: "fmr_1",
            expiresAt,
        });
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "US" });

        expect(
            queriesMock.createFoundingMemberReservation,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                capacity: 100,
                stripePriceId: "price_usd",
                userId: "user_1",
            }),
        );
        expect(
            queriesMock.createFoundingMemberReservation.mock
                .invocationCallOrder[0],
        ).toBeLessThan(
            stripeMock.checkout.sessions.create.mock.invocationCallOrder[0],
        );
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                expires_at: Math.floor(expiresAt.getTime() / 1000),
                metadata: expect.objectContaining({
                    foundingReservationId: "fmr_1",
                    foundingReservationExpiresAt: expiresAt.toISOString(),
                }),
                subscription_data: expect.objectContaining({
                    metadata: expect.objectContaining({
                        foundingReservationId: "fmr_1",
                        foundingReservationExpiresAt: expiresAt.toISOString(),
                    }),
                }),
            }),
            expect.any(Object),
        );
        expect(
            queriesMock.attachFoundingMemberReservationToCheckoutSession,
        ).toHaveBeenCalledWith({
            reservationId: "fmr_1",
            checkoutSessionId: "cs_1",
        });
    });

    it("releases a founding reservation when Stripe session creation fails", async () => {
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            id: "fmr_1",
            expiresAt: new Date("2026-07-01T00:35:00.000Z"),
        });
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd",
        });
        stripeMock.checkout.sessions.create.mockRejectedValue(
            new Error("stripe down"),
        );

        await expect(
            startSubscriptionCheckout({ ...baseInput, country: "US" }),
        ).rejects.toThrow("stripe down");

        expect(
            queriesMock.releaseFoundingMemberReservation,
        ).toHaveBeenCalledWith(
            expect.objectContaining({ reservationId: "fmr_1" }),
        );
    });

    it("expires the Stripe Session if attaching the founding reservation fails", async () => {
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            id: "fmr_1",
            expiresAt: new Date("2026-07-01T00:35:00.000Z"),
        });
        queriesMock.attachFoundingMemberReservationToCheckoutSession.mockResolvedValue(
            false,
        );
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd",
        });

        await expect(
            startSubscriptionCheckout({ ...baseInput, country: "US" }),
        ).rejects.toMatchObject({ code: "price_unavailable" });

        expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith(
            "cs_1",
        );
    });

    it("uses the standard monthly price when founding capacity is gone", async () => {
        queriesMock.createFoundingMemberReservation.mockResolvedValue(null);
        pricingMock.resolvePrice
            .mockReturnValueOnce({ currency: "usd", priceId: "price_usd" })
            .mockReturnValueOnce({
                currency: "usd",
                priceId: "price_usd_standard",
            });

        await startSubscriptionCheckout({ ...baseInput, country: "US" });

        expect(pricingMock.resolvePrice).toHaveBeenNthCalledWith(
            1,
            "US",
            "month",
            "founding",
        );
        expect(pricingMock.resolvePrice).toHaveBeenNthCalledWith(
            2,
            "US",
            "month",
            "standard",
        );
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                line_items: [{ price: "price_usd_standard", quantity: 1 }],
                metadata: { userId: "user_1" },
            }),
            expect.any(Object),
        );
    });

    it("uses the selected annual interval for Checkout", async () => {
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd_year",
        });

        await startSubscriptionCheckout({
            ...baseInput,
            country: "US",
            interval: "year",
        });

        expect(pricingMock.resolvePrice).toHaveBeenCalledWith(
            "US",
            "year",
            "standard",
        );
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                line_items: [{ price: "price_usd_year", quantity: 1 }],
            }),
            expect.any(Object),
        );
    });

    it("turns an unavailable annual price into a controlled precondition error", async () => {
        pricingMock.resolvePrice.mockImplementation(() => {
            throw new Error("no annual price");
        });

        await expect(
            startSubscriptionCheckout({
                ...baseInput,
                country: "US",
                interval: "year",
            }),
        ).rejects.toMatchObject({ code: "price_unavailable" });
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("applies the EUR VAT rate to EUR subscriptions when configured", async () => {
        envMock.STRIPE_TAX_RATE_ID_EUR = "txr_vat";
        pricingMock.resolvePrice.mockReturnValue({
            currency: "eur",
            priceId: "price_eur",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "DE" });

        expect(subscriptionDataFromLastCall().default_tax_rates).toEqual([
            "txr_vat",
        ]);
    });

    it("never applies a tax rate to USD subscriptions", async () => {
        envMock.STRIPE_TAX_RATE_ID_EUR = "txr_vat";
        pricingMock.resolvePrice.mockReturnValue({
            currency: "usd",
            priceId: "price_usd",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "US" });

        expect(
            subscriptionDataFromLastCall().default_tax_rates,
        ).toBeUndefined();
    });

    it("omits the tax rate for EUR when none is configured", async () => {
        envMock.STRIPE_TAX_RATE_ID_EUR = undefined;
        pricingMock.resolvePrice.mockReturnValue({
            currency: "eur",
            priceId: "price_eur",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "FR" });

        expect(
            subscriptionDataFromLastCall().default_tax_rates,
        ).toBeUndefined();
    });
});
