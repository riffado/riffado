import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, stripeMock, pricingMock, mirrorMock, vatMock, envMock } =
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
            checkout: {
                sessions: {
                    create: vi.fn(),
                    expire: vi.fn(),
                    retrieve: vi.fn(),
                },
            },
            customers: { create: vi.fn() },
            subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
            billingPortal: { sessions: { create: vi.fn() } },
        },
        pricingMock: {
            isFoundingMonthlyPriceId: vi.fn().mockReturnValue(false),
            resolvePrice: vi.fn(),
            resolveStandardMonthlyPriceForCurrency: vi
                .fn()
                .mockReturnValue({ priceId: "price_standard" }),
        },
        mirrorMock: {
            mirrorStripeSubscription: vi.fn(),
            mirrorCheckoutSession: vi.fn(),
        },
        vatMock: { prepareCustomerTaxIdentity: vi.fn() },
        envMock: {
            APP_URL: "https://app.example",
            STRIPE_PORTAL_CONFIGURATION_ID: undefined as string | undefined,
            BILLING_FOUNDING_MEMBER_CAPACITY: 100,
        },
    }));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/pricing", () => pricingMock);
vi.mock("@/lib/hosted/billing/mirror", () => mirrorMock);
vi.mock("@/lib/hosted/billing/vat-id", () => vatMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => ({
    getStripe: () => stripeMock,
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    cancelSubscriptionImmediatelyForDeletion,
    createBillingPortalSession,
    getOrCreateStripeCustomer,
    startSubscriptionCheckout,
} from "@/lib/hosted/billing/checkout";

const baseInput = {
    userId: "user_1",
    userEmail: "u@example.com",
    userName: "U",
    withdrawalWaiverAcceptedAt: new Date("2026-07-01T00:00:00.000Z"),
    idempotencyKey: "checkout:user_1:nonce",
};

function checkoutParamsFromLastCall(): Record<string, unknown> {
    const [params] =
        stripeMock.checkout.sessions.create.mock.calls.at(-1) ?? [];
    return params as Record<string, unknown>;
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

describe("cancelSubscriptionImmediatelyForDeletion", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does nothing when the user has no Stripe subscription", async () => {
        queriesMock.getSubscriptionByUserId.mockResolvedValue(null);

        await cancelSubscriptionImmediatelyForDeletion("user_1");

        expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it("cancels a live subscription immediately", async () => {
        queriesMock.getSubscriptionByUserId.mockResolvedValue({
            id: "sub_1",
            status: "active",
        });
        stripeMock.subscriptions.retrieve.mockResolvedValue({
            id: "sub_1",
            status: "active",
        });
        stripeMock.subscriptions.cancel.mockResolvedValue({
            id: "sub_1",
            status: "canceled",
        });

        await cancelSubscriptionImmediatelyForDeletion("user_1");

        expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    });

    it("does not cancel an already terminal subscription", async () => {
        queriesMock.getSubscriptionByUserId.mockResolvedValue({
            id: "sub_1",
            status: "canceled",
        });

        await cancelSubscriptionImmediatelyForDeletion("user_1");

        expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
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
            }),
        ).rejects.toMatchObject({ code: "missing_portal_configuration" });
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it("pins the configured Portal with plan switching disabled by the operator", async () => {
        envMock.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_safe";

        await expect(
            createBillingPortalSession({
                userId: "user_1",
            }),
        ).resolves.toBe("https://billing.stripe.com/session/test");
        expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
            customer: "cus_1",
            return_url: "https://app.example/settings#billing",
            configuration: "bpc_safe",
        });
    });
});

describe("startSubscriptionCheckout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queriesMock.getSubscriptionByUserId.mockResolvedValue(null);
        queriesMock.getFoundingMemberAvailability.mockResolvedValue({
            capacity: 100,
            claimed: 0,
            reserved: 0,
            remaining: 100,
        });
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            kind: "reserved",
            reservation: {
                id: "fmr_1",
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            },
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
            kind: "reserved",
            reservation: { id: "fmr_1", expiresAt },
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
            kind: "reserved",
            reservation: {
                id: "fmr_1",
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            },
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
            kind: "reserved",
            reservation: {
                id: "fmr_1",
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            },
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
        queriesMock.createFoundingMemberReservation.mockResolvedValue({
            kind: "unavailable",
        });
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

    it("uses server-owned return URLs and Stripe Automatic Tax", async () => {
        pricingMock.resolvePrice.mockReturnValue({
            currency: "eur",
            priceId: "price_eur",
        });

        await startSubscriptionCheckout({ ...baseInput, country: "DE" });

        expect(checkoutParamsFromLastCall()).toMatchObject({
            success_url: "https://app.example/settings#billing",
            cancel_url: "https://app.example/settings#billing",
            automatic_tax: { enabled: true },
            billing_address_collection: "required",
        });
        const subscriptionData = checkoutParamsFromLastCall()
            .subscription_data as Record<string, unknown>;
        expect(subscriptionData.default_tax_rates).toBeUndefined();
    });

    it("prepares a verified business identity before creating Checkout", async () => {
        pricingMock.resolvePrice.mockReturnValue({
            currency: "eur",
            priceId: "price_eur",
        });
        const business = { name: "Example GmbH", vatId: "DE123456789" };

        await startSubscriptionCheckout({
            ...baseInput,
            country: "DE",
            business,
        });

        expect(vatMock.prepareCustomerTaxIdentity).toHaveBeenCalledWith({
            stripeCustomerId: "cus_1",
            business,
        });
        expect(
            vatMock.prepareCustomerTaxIdentity.mock.invocationCallOrder[0],
        ).toBeLessThan(
            stripeMock.checkout.sessions.create.mock.invocationCallOrder[0],
        );
    });

    describe("superseding a stale founding reservation", () => {
        beforeEach(() => {
            pricingMock.resolvePrice.mockReturnValue({
                currency: "usd",
                priceId: "price_usd",
            });
        });

        it("releases an expired prior reservation and issues a fresh one", async () => {
            queriesMock.createFoundingMemberReservation
                .mockResolvedValueOnce({
                    kind: "already_reserved",
                    existing: {
                        id: "fmr_stale",
                        stripeCheckoutSessionId: "cs_stale",
                    },
                })
                .mockResolvedValueOnce({
                    kind: "reserved",
                    reservation: {
                        id: "fmr_fresh",
                        expiresAt: new Date("2026-07-01T00:35:00.000Z"),
                    },
                });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue({
                id: "cs_stale",
                status: "expired",
            });

            await startSubscriptionCheckout({ ...baseInput, country: "US" });

            expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(
                "cs_stale",
            );
            expect(
                queriesMock.releaseFoundingMemberReservation,
            ).toHaveBeenCalledWith(
                expect.objectContaining({ reservationId: "fmr_stale" }),
            );
            expect(
                queriesMock.createFoundingMemberReservation,
            ).toHaveBeenCalledTimes(2);
            expect(
                queriesMock.attachFoundingMemberReservationToCheckoutSession,
            ).toHaveBeenCalledWith(
                expect.objectContaining({ reservationId: "fmr_fresh" }),
            );
        });

        it("reopens the still-open prior Checkout Session instead of erroring", async () => {
            queriesMock.createFoundingMemberReservation.mockResolvedValue({
                kind: "already_reserved",
                existing: {
                    id: "fmr_stale",
                    stripeCheckoutSessionId: "cs_open",
                },
            });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue({
                id: "cs_open",
                status: "open",
                url: "https://checkout.stripe.com/cs_open",
            });

            const result = await startSubscriptionCheckout({
                ...baseInput,
                country: "US",
            });

            expect(result).toEqual({
                checkoutUrl: "https://checkout.stripe.com/cs_open",
                sessionId: "cs_open",
            });
            expect(
                queriesMock.releaseFoundingMemberReservation,
            ).not.toHaveBeenCalled();
            expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        });

        it("still errors when the still-open prior session has no URL to reopen", async () => {
            queriesMock.createFoundingMemberReservation.mockResolvedValue({
                kind: "already_reserved",
                existing: {
                    id: "fmr_stale",
                    stripeCheckoutSessionId: "cs_open",
                },
            });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue({
                id: "cs_open",
                status: "open",
                url: null,
            });

            await expect(
                startSubscriptionCheckout({ ...baseInput, country: "US" }),
            ).rejects.toMatchObject({ code: "checkout_in_progress" });

            expect(
                queriesMock.releaseFoundingMemberReservation,
            ).not.toHaveBeenCalled();
            expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        });

        it("mirrors an already-paid prior session instead of releasing it", async () => {
            queriesMock.createFoundingMemberReservation.mockResolvedValue({
                kind: "already_reserved",
                existing: {
                    id: "fmr_stale",
                    stripeCheckoutSessionId: "cs_paid",
                },
            });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue({
                id: "cs_paid",
                status: "complete",
            });

            await expect(
                startSubscriptionCheckout({ ...baseInput, country: "US" }),
            ).rejects.toMatchObject({ code: "already_subscribed" });

            expect(mirrorMock.mirrorCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ id: "cs_paid", status: "complete" }),
            );
            expect(
                queriesMock.releaseFoundingMemberReservation,
            ).not.toHaveBeenCalled();
            expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        });

        it("falls back to standard pricing when a retry after release still finds no capacity", async () => {
            queriesMock.createFoundingMemberReservation
                .mockResolvedValueOnce({
                    kind: "already_reserved",
                    existing: {
                        id: "fmr_stale",
                        stripeCheckoutSessionId: "cs_stale",
                    },
                })
                .mockResolvedValueOnce({ kind: "unavailable" });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue({
                id: "cs_stale",
                status: "expired",
            });
            pricingMock.resolvePrice
                .mockReturnValueOnce({ currency: "usd", priceId: "price_usd" })
                .mockReturnValueOnce({
                    currency: "usd",
                    priceId: "price_usd_standard",
                });

            await startSubscriptionCheckout({ ...baseInput, country: "US" });

            expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    line_items: [{ price: "price_usd_standard", quantity: 1 }],
                }),
                expect.any(Object),
            );
        });
    });
});
