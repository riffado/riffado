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

import { startSubscriptionCheckout } from "@/lib/hosted/billing/checkout";

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
