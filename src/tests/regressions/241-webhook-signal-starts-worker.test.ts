/**
 * Regression test for issue #241 (bug 2): webhook deliveries sat
 * `pending` with 0 attempts, including after Redeliver. Redeliver and
 * emit both call `signalWebhookWorker()`, which previously returned
 * immediately when `started` was false.
 */

import { describe, expect, it, vi } from "vitest";

const { claimDueWebhookDeliveries } = vi.hoisted(() => ({
    claimDueWebhookDeliveries: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/db", () => ({
    db: {
        execute: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/db/queries/webhook-deliveries", () => ({
    claimDueWebhookDeliveries,
    releaseClaimedDelivery: vi.fn(),
    reloadClaimedDeliveryForSend: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        APP_URL: "http://localhost:3000",
        WEBHOOKS_REQUIRE_PUBLIC_TARGETS: undefined,
    },
}));

import { signalWebhookWorker } from "@/lib/webhooks/worker";

describe("issue #241: webhook signal starts an unstarted worker", () => {
    it("first signal runs a delivery pass", async () => {
        signalWebhookWorker();
        await vi.waitFor(() => {
            expect(claimDueWebhookDeliveries).toHaveBeenCalled();
        });
    });
});
