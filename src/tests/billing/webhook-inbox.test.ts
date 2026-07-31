import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, webhookMock } = vi.hoisted(() => ({
    queryMock: {
        claimDueStripeWebhookEvents: vi.fn(),
        completeStripeWebhookEvent: vi.fn(),
        completeStripeWebhookEventUnderLock: vi.fn(),
        failStripeWebhookEvent: vi.fn(),
        renewStripeWebhookEventClaim: vi.fn(),
        withStripeWebhookEventLock: vi.fn(),
    },
    webhookMock: { handleStripeWebhook: vi.fn() },
}));

vi.mock("@/db/queries/billing", () => queryMock);
vi.mock("@/lib/hosted/billing/webhook", () => webhookMock);
vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
}));

import { processStripeWebhookInbox } from "@/lib/hosted/billing/webhook-inbox";

const inboxEvent = {
    eventId: "evt_1",
    type: "customer.subscription.updated",
    eventCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { id: "sub_1" },
    attempts: 0,
    claimToken: "claim_1",
};

describe("Stripe webhook inbox", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMock.claimDueStripeWebhookEvents.mockResolvedValue([inboxEvent]);
        queryMock.completeStripeWebhookEvent.mockResolvedValue(true);
        queryMock.completeStripeWebhookEventUnderLock.mockResolvedValue(true);
        queryMock.renewStripeWebhookEventClaim.mockResolvedValue(true);
        queryMock.withStripeWebhookEventLock.mockImplementation(
            (_eventId: string, run: () => Promise<unknown>) => run(),
        );
    });

    it("completes a successfully dispatched event", async () => {
        const result = await processStripeWebhookInbox();

        expect(webhookMock.handleStripeWebhook).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "evt_1",
                type: "customer.subscription.updated",
                data: { object: { id: "sub_1" } },
            }),
        );
        expect(queryMock.withStripeWebhookEventLock).toHaveBeenCalledWith(
            "evt_1",
            expect.any(Function),
        );
        expect(queryMock.renewStripeWebhookEventClaim).toHaveBeenCalledWith({
            eventId: "evt_1",
            claimToken: "claim_1",
            processingLeaseMs: 15 * 60 * 1000,
        });
        expect(queryMock.completeStripeWebhookEvent).toHaveBeenCalledWith({
            eventId: "evt_1",
            claimToken: "claim_1",
        });
        expect(result).toEqual({
            claimed: 1,
            completed: 1,
            retried: 0,
            failed: 0,
        });
    });

    it("completes under the advisory lock when a replacement claim arrives during handling", async () => {
        queryMock.renewStripeWebhookEventClaim
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        const result = await processStripeWebhookInbox();

        expect(
            queryMock.completeStripeWebhookEventUnderLock,
        ).toHaveBeenCalledWith("evt_1");
        expect(queryMock.completeStripeWebhookEvent).not.toHaveBeenCalled();
        expect(result).toEqual({
            claimed: 1,
            completed: 1,
            retried: 0,
            failed: 0,
        });
    });

    it("does not dispatch an event after its claim is lost", async () => {
        queryMock.renewStripeWebhookEventClaim.mockResolvedValue(false);

        const result = await processStripeWebhookInbox();

        expect(webhookMock.handleStripeWebhook).not.toHaveBeenCalled();
        expect(queryMock.completeStripeWebhookEvent).not.toHaveBeenCalled();
        expect(result).toEqual({
            claimed: 1,
            completed: 0,
            retried: 0,
            failed: 0,
        });
    });

    it("requeues a transient failure with the next attempt's backoff", async () => {
        webhookMock.handleStripeWebhook.mockRejectedValue(
            new Error("Stripe down"),
        );
        queryMock.failStripeWebhookEvent.mockResolvedValue({
            status: "pending",
            attempts: 2,
        });

        const before = Date.now();
        const result = await processStripeWebhookInbox();

        expect(queryMock.failStripeWebhookEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventId: "evt_1",
                claimToken: "claim_1",
                errorMessage: "Stripe down",
                maxAttempts: 5,
                retryAt: expect.any(Date),
            }),
        );
        const retryAt = queryMock.failStripeWebhookEvent.mock.calls[0]?.[0]
            ?.retryAt as Date;
        expect(retryAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
        expect(result).toEqual({
            claimed: 1,
            completed: 0,
            retried: 1,
            failed: 0,
        });
    });
});
