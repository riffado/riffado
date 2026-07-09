import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, mirrorMock, stripeMock, emailMock, dbMock } = vi.hoisted(
    () => ({
        queriesMock: {
            claimWebhookDelivery: vi.fn(),
            getBillingCustomerByStripeId: vi.fn().mockResolvedValue(null),
        },
        mirrorMock: {
            mirrorCheckoutSession: vi.fn(),
            mirrorSubscriptionById: vi.fn(),
        },
        stripeMock: {
            getStripe: vi.fn(),
        },
        emailMock: { sendPaymentFailedEmail: vi.fn() },
        dbMock: { select: vi.fn() },
    }),
);

vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/hosted/billing/mirror", () => mirrorMock);
vi.mock("@/lib/hosted/billing/stripe-client", () => stripeMock);
vi.mock("@/lib/notifications/email", () => emailMock);
vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/lib/env", () => ({
    env: { APP_URL: "https://app.example.com" },
}));

import { handleStripeWebhook } from "@/lib/hosted/billing/webhook";

function event(type: string, object: unknown): Stripe.Event {
    return {
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type,
        data: { object },
    } as unknown as Stripe.Event;
}

describe("handleStripeWebhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queriesMock.claimWebhookDelivery.mockResolvedValue({ eventId: "x" });
    });

    it("skips processing on a duplicate delivery", async () => {
        queriesMock.claimWebhookDelivery.mockResolvedValue(null);
        await handleStripeWebhook(
            event("customer.subscription.updated", { id: "sub_1" }),
        );
        expect(mirrorMock.mirrorSubscriptionById).not.toHaveBeenCalled();
    });

    it("mirrors a completed checkout session", async () => {
        const session = { id: "cs_1", subscription: "sub_1" };
        await handleStripeWebhook(event("checkout.session.completed", session));
        expect(mirrorMock.mirrorCheckoutSession).toHaveBeenCalledWith(session);
    });

    it("mirrors subscription lifecycle events by id", async () => {
        await handleStripeWebhook(
            event("customer.subscription.deleted", { id: "sub_9" }),
        );
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenCalledWith("sub_9");
    });

    it("mirrors the subscription on invoice.paid (dahlia parent shape)", async () => {
        await handleStripeWebhook(
            event("invoice.paid", {
                id: "in_1",
                parent: { subscription_details: { subscription: "sub_5" } },
            }),
        );
        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenCalledWith("sub_5");
    });

    it("ignores unrelated event types", async () => {
        await handleStripeWebhook(event("charge.succeeded", { id: "ch_1" }));
        expect(mirrorMock.mirrorCheckoutSession).not.toHaveBeenCalled();
        expect(mirrorMock.mirrorSubscriptionById).not.toHaveBeenCalled();
    });

    it("re-mirrors and emails on invoice.payment_failed", async () => {
        stripeMock.getStripe.mockReturnValue({
            subscriptions: {
                retrieve: vi.fn().mockResolvedValue({
                    id: "sub_pf",
                    metadata: { userId: "u1" },
                    items: { data: [{ current_period_end: 1_900_000_000 }] },
                }),
            },
        });
        dbMock.select.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ email: "u1@example.com" }]),
                }),
            }),
        });
        emailMock.sendPaymentFailedEmail.mockResolvedValue(true);

        await handleStripeWebhook(
            event("invoice.payment_failed", {
                id: "in_pf",
                next_payment_attempt: 1_800_000_000,
                parent: { subscription_details: { subscription: "sub_pf" } },
            }),
        );

        expect(mirrorMock.mirrorSubscriptionById).toHaveBeenCalledWith(
            "sub_pf",
        );
        expect(emailMock.sendPaymentFailedEmail).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1", email: "u1@example.com" }),
        );
    });

    it("resolves userId via the billing-customer mapping when metadata.userId is missing", async () => {
        stripeMock.getStripe.mockReturnValue({
            subscriptions: {
                retrieve: vi.fn().mockResolvedValue({
                    id: "sub_pf2",
                    metadata: {},
                    customer: "cus_abc",
                    items: { data: [{ current_period_end: 1_900_000_000 }] },
                }),
            },
        });
        queriesMock.getBillingCustomerByStripeId.mockResolvedValue({
            userId: "u2",
        });
        dbMock.select.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ email: "u2@example.com" }]),
                }),
            }),
        });
        emailMock.sendPaymentFailedEmail.mockResolvedValue(true);

        await handleStripeWebhook(
            event("invoice.payment_failed", {
                id: "in_pf2",
                next_payment_attempt: 1_800_000_000,
                parent: { subscription_details: { subscription: "sub_pf2" } },
            }),
        );

        expect(queriesMock.getBillingCustomerByStripeId).toHaveBeenCalledWith(
            "cus_abc",
        );
        expect(emailMock.sendPaymentFailedEmail).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u2", email: "u2@example.com" }),
        );
    });

    it("skips the email entirely when neither metadata nor the billing-customer mapping resolve a user", async () => {
        stripeMock.getStripe.mockReturnValue({
            subscriptions: {
                retrieve: vi.fn().mockResolvedValue({
                    id: "sub_pf3",
                    metadata: {},
                    customer: "cus_unknown",
                    items: { data: [{ current_period_end: 1_900_000_000 }] },
                }),
            },
        });
        queriesMock.getBillingCustomerByStripeId.mockResolvedValue(null);

        await handleStripeWebhook(
            event("invoice.payment_failed", {
                id: "in_pf3",
                next_payment_attempt: 1_800_000_000,
                parent: { subscription_details: { subscription: "sub_pf3" } },
            }),
        );

        expect(emailMock.sendPaymentFailedEmail).not.toHaveBeenCalled();
    });
});
