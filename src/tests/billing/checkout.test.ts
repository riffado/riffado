import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, stripeMock, pricingMock, mirrorMock, envMock } =
    vi.hoisted(() => ({
        queriesMock: {
            getBillingCustomerByUserId: vi.fn(),
            getSubscriptionByUserId: vi.fn(),
            upsertBillingCustomer: vi.fn(),
        },
        stripeMock: {
            checkout: { sessions: { create: vi.fn() } },
            customers: { create: vi.fn() },
        },
        pricingMock: { resolvePrice: vi.fn() },
        mirrorMock: { mirrorStripeSubscription: vi.fn() },
        envMock: { STRIPE_TAX_RATE_ID_EUR: undefined as string | undefined },
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

describe("startSubscriptionCheckout tax rates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.STRIPE_TAX_RATE_ID_EUR = undefined;
        queriesMock.getSubscriptionByUserId.mockResolvedValue(null);
        queriesMock.getBillingCustomerByUserId.mockResolvedValue({
            stripeCustomerId: "cus_1",
        });
        stripeMock.checkout.sessions.create.mockResolvedValue({
            url: "https://checkout.stripe.com/x",
            id: "cs_1",
        });
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
