import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        WEBHOOKS_REQUIRE_PUBLIC_TARGETS: undefined,
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, ""),
    ),
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/webhooks/worker", () => ({
    signalWebhookWorker: vi.fn(),
}));

import { POST as redeliverWebhook } from "@/app/api/settings/webhooks/[id]/deliveries/[deliveryId]/redeliver/route";
import { PATCH as updateWebhook } from "@/app/api/settings/webhooks/[id]/route";
import { POST as createWebhook } from "@/app/api/settings/webhooks/route";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { signalWebhookWorker } from "@/lib/webhooks/worker";

const now = new Date("2026-05-06T12:00:00.000Z");

function routeRequest(path: string, init?: RequestInit) {
    return new Request(`http://localhost${path}`, init);
}

function routeParams(id = "wh-1") {
    return { params: Promise.resolve({ id }) };
}

function redeliveryParams(id = "wh-1", deliveryId = "delivery-1") {
    return { params: Promise.resolve({ id, deliveryId }) };
}

function webhookEndpoint(overrides: Record<string, unknown> = {}) {
    return {
        id: "wh-1",
        userId: "user-1",
        url: "encrypted:https://example.com/webhook",
        secret: "encrypted:whsec_abcdefghijkl",
        events: ["recording.synced"],
        description: null,
        enabled: true,
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe("webhook settings routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    it("encrypts webhook URLs at rest when creating endpoints", async () => {
        let inserted: Record<string, unknown> = {};
        (db.insert as Mock).mockReturnValue({
            values: vi.fn((values: Record<string, unknown>) => {
                inserted = values;
                return {
                    returning: vi
                        .fn()
                        .mockResolvedValue([webhookEndpoint(values)]),
                };
            }),
        });

        const response = await createWebhook(
            routeRequest("/api/settings/webhooks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: "https://example.com/hook?token=secret",
                    events: ["recording.synced"],
                }),
            }),
        );

        expect(response.status).toBe(201);
        expect(inserted?.url).toBe(
            "encrypted:https://example.com/hook?token=secret",
        );
        const body = (await response.json()) as {
            webhook: { url: string };
        };
        expect(body.webhook.url).toBe("https://example.com/hook?token=secret");
    });

    it("encrypts webhook URLs at rest when updating endpoints", async () => {
        let updates: Record<string, unknown> = {};
        (db.update as Mock).mockReturnValue({
            set: vi.fn((values: Record<string, unknown>) => {
                updates = values;
                return {
                    where: vi.fn().mockReturnValue({
                        returning: vi
                            .fn()
                            .mockResolvedValue([webhookEndpoint(values)]),
                    }),
                };
            }),
        });

        const response = await updateWebhook(
            routeRequest("/api/settings/webhooks/wh-1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: "https://example.com/new?token=secret",
                }),
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(updates?.url).toBe(
            "encrypted:https://example.com/new?token=secret",
        );
        const body = (await response.json()) as {
            webhook: { url: string };
        };
        expect(body.webhook.url).toBe("https://example.com/new?token=secret");
    });

    it("rejects manual redelivery for disabled webhooks", async () => {
        (db.select as Mock).mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ id: "wh-1", enabled: false }]),
                }),
            }),
        });

        const response = await redeliverWebhook(
            routeRequest(
                "/api/settings/webhooks/wh-1/deliveries/delivery-1/redeliver",
                { method: "POST" },
            ),
            redeliveryParams(),
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "Webhook is disabled",
        });
        expect(db.update).not.toHaveBeenCalled();
        expect(signalWebhookWorker).not.toHaveBeenCalled();
    });
});
