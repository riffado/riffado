import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(),
}));

vi.mock("node:http", () => ({
    request: vi.fn(),
}));

vi.mock("node:https", () => ({
    request: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, ""),
    ),
}));

vi.mock("@/lib/v1/serialize", () => ({
    getV1RecordingDetailForUser: vi.fn().mockResolvedValue({
        id: "rec-1",
        title: "Current Recording",
        transcript: { text: "Current transcript" },
        summary: { text: "Current summary" },
    }),
}));

import { db } from "@/db";
import { getV1RecordingDetailForUser } from "@/lib/v1/serialize";
import {
    decryptWebhookSecret,
    encryptWebhookSecret,
    maskStoredWebhookSecret,
} from "@/lib/webhooks/secrets";
import {
    createWebhookSignature,
    formatWebhookSignatureHeader,
    verifyWebhookSignature,
} from "@/lib/webhooks/signature";
import { parseWebhookUrl } from "@/lib/webhooks/url";
import { deliverDueWebhooks, getWebhookBackoffMs } from "@/lib/webhooks/worker";

type MockClientRequest = EventEmitter & {
    write: Mock;
    end: Mock;
    destroy: Mock;
};

let lastMockRequest: MockClientRequest | null = null;

function mockHttpsResponse(statusCode: number, body: string) {
    (httpsRequest as unknown as Mock).mockImplementation(
        (
            _options: RequestOptions,
            callback: (
                response: EventEmitter & {
                    statusCode: number;
                    setEncoding: Mock;
                },
            ) => void,
        ) => {
            const response = new EventEmitter() as EventEmitter & {
                statusCode: number;
                setEncoding: Mock;
            };
            response.statusCode = statusCode;
            response.setEncoding = vi.fn();

            const request = new EventEmitter() as MockClientRequest;
            request.write = vi.fn();
            request.end = vi.fn(() => {
                callback(response);
                response.emit("data", body);
                response.emit("end");
            });
            request.destroy = vi.fn((error?: Error) => {
                request.emit("error", error ?? new Error("Request destroyed"));
            });
            lastMockRequest = request;

            return request;
        },
    );
}

describe("webhooks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        lastMockRequest = null;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("formats and verifies HMAC signatures", () => {
        const body = JSON.stringify({ event: "recording.synced" });
        const secret = "whsec_test";
        const timestamp = 1778078610;
        const signature = createWebhookSignature(secret, timestamp, body);
        const header = formatWebhookSignatureHeader(secret, timestamp, body);

        expect(signature).toHaveLength(64);
        expect(header).toBe(`t=${timestamp},v1=${signature}`);
        expect(
            verifyWebhookSignature(secret, header, body, 300, timestamp + 60),
        ).toBe(true);
        expect(
            verifyWebhookSignature(
                secret,
                header,
                JSON.stringify({ event: "recording.updated" }),
                300,
                timestamp + 60,
            ),
        ).toBe(false);
    });

    it("uses the documented retry backoff schedule", () => {
        expect(getWebhookBackoffMs(1)).toBe(30_000);
        expect(getWebhookBackoffMs(2)).toBe(120_000);
        expect(getWebhookBackoffMs(3)).toBe(600_000);
        expect(getWebhookBackoffMs(4)).toBe(3_600_000);
        expect(getWebhookBackoffMs(5)).toBe(21_600_000);
        expect(getWebhookBackoffMs(99)).toBe(21_600_000);
    });

    it("rejects non-HTTPS, local, and private webhook targets", () => {
        expect(() =>
            parseWebhookUrl("https://example.com/webhook"),
        ).not.toThrow();
        expect(() => parseWebhookUrl("ftp://example.com/webhook")).toThrow(
            "Webhook URL must use HTTPS",
        );
        expect(() => parseWebhookUrl("http://example.com/webhook")).toThrow(
            "Webhook URL must use HTTPS",
        );
        expect(() => parseWebhookUrl("https://localhost:3000/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );
        expect(() => parseWebhookUrl("https://127.0.0.1/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );
        expect(() => parseWebhookUrl("https://10.0.0.1/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );
        expect(() => parseWebhookUrl("https://[::1]/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );
        expect(() => parseWebhookUrl("https://[::ffff:7f00:1]/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );
    });

    it("encrypts webhook secrets before storage and masks decrypted values", () => {
        const secret = "whsec_abcdefghijkl";
        const encrypted = encryptWebhookSecret(secret);

        expect(encrypted).toBe(`encrypted:${secret}`);
        expect(decryptWebhookSecret(encrypted)).toBe(secret);
        expect(decryptWebhookSecret(secret)).toBe(secret);
        expect(maskStoredWebhookSecret(encrypted)).toBe("whsec_****ijkl");
    });

    it("pins delivery requests to the validated DNS address", async () => {
        (lookup as unknown as Mock).mockResolvedValue([
            { address: "93.184.216.34", family: 4 },
        ]);

        const now = new Date("2026-05-06T12:00:00.000Z");
        const delivery = {
            id: "delivery-1",
            endpointId: "endpoint-1",
            userId: "user-1",
            recordingId: "rec-1",
            event: "recording.synced",
            payload: {
                event: "recording.synced",
                recording_id: "rec-1",
                delivered_at: now.toISOString(),
                data: { id: "stale", transcript: { text: "Stale" } },
            },
            status: "pending",
            attempts: 0,
            lastAttemptAt: null,
            nextAttemptAt: now,
            lastResponseStatus: null,
            lastResponseBody: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
        };
        const endpoint = {
            id: "endpoint-1",
            userId: "user-1",
            url: "https://example.com/webhook",
            secret: "encrypted:whsec_abcdefghijkl",
            events: ["recording.synced"],
            description: null,
            enabled: true,
            lastDeliveryAt: null,
            lastDeliveryStatus: null,
            createdAt: now,
            updatedAt: now,
        };

        const selectChain = {
            innerJoin: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn().mockResolvedValue([{ delivery, endpoint }]),
        };
        selectChain.innerJoin.mockReturnValue(selectChain);
        selectChain.where.mockReturnValue(selectChain);
        selectChain.orderBy.mockReturnValue(selectChain);
        (db.select as Mock).mockReturnValue({
            from: vi.fn().mockReturnValue(selectChain),
        });

        const updateChain = {
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        };
        (db.transaction as Mock).mockImplementation(async (callback) => {
            await callback({
                update: vi.fn().mockReturnValue(updateChain),
            });
        });

        mockHttpsResponse(204, "");

        await deliverDueWebhooks();

        expect(httpsRequest).toHaveBeenCalledTimes(1);
        expect(getV1RecordingDetailForUser).toHaveBeenCalledWith(
            "user-1",
            "rec-1",
        );
        const requestBody = JSON.parse(
            String(lastMockRequest?.write.mock.calls[0]?.[0] ?? "{}"),
        ) as { data?: { id?: string; transcript?: { text?: string } } };
        expect(requestBody.data).toMatchObject({
            id: "rec-1",
            transcript: { text: "Current transcript" },
        });
        const requestOptions = (httpsRequest as unknown as Mock).mock
            .calls[0][0] as RequestOptions & { lookup: LookupFunction };
        expect(requestOptions.hostname).toBe("example.com");

        let resolvedAddress = "";
        let resolvedFamily = 0;
        requestOptions.lookup(
            "example.com",
            { family: 4 },
            (error, address, family) => {
                expect(error).toBeNull();
                resolvedAddress =
                    typeof address === "string"
                        ? address
                        : address[0]?.address || "";
                resolvedFamily =
                    family ??
                    (typeof address === "string" ? 0 : address[0]?.family || 0);
            },
        );

        expect(resolvedAddress).toBe("93.184.216.34");
        expect(resolvedFamily).toBe(4);
    });

    it("does not auto-follow webhook delivery redirects", async () => {
        const now = new Date("2026-05-06T12:00:00.000Z");
        const delivery = {
            id: "delivery-1",
            endpointId: "endpoint-1",
            userId: "user-1",
            recordingId: "rec-1",
            event: "recording.synced",
            payload: {
                event: "recording.synced",
                recording_id: "rec-1",
                delivered_at: now.toISOString(),
            },
            status: "pending",
            attempts: 0,
            lastAttemptAt: null,
            nextAttemptAt: now,
            lastResponseStatus: null,
            lastResponseBody: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
        };
        const endpoint = {
            id: "endpoint-1",
            userId: "user-1",
            url: "https://93.184.216.34/webhook",
            secret: "encrypted:whsec_abcdefghijkl",
            events: ["recording.synced"],
            description: null,
            enabled: true,
            lastDeliveryAt: null,
            lastDeliveryStatus: null,
            createdAt: now,
            updatedAt: now,
        };

        const selectChain = {
            innerJoin: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn().mockResolvedValue([{ delivery, endpoint }]),
        };
        selectChain.innerJoin.mockReturnValue(selectChain);
        selectChain.where.mockReturnValue(selectChain);
        selectChain.orderBy.mockReturnValue(selectChain);
        (db.select as Mock).mockReturnValue({
            from: vi.fn().mockReturnValue(selectChain),
        });

        const updateChain = {
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        };
        (db.transaction as Mock).mockImplementation(async (callback) => {
            await callback({
                update: vi.fn().mockReturnValue(updateChain),
            });
        });

        mockHttpsResponse(302, "redirect");

        await deliverDueWebhooks();

        expect(httpsRequest).toHaveBeenCalledTimes(1);
    });

    it("refuses already-stored HTTP endpoints before sending", async () => {
        const now = new Date("2026-05-06T12:00:00.000Z");
        const delivery = {
            id: "delivery-1",
            endpointId: "endpoint-1",
            userId: "user-1",
            recordingId: "rec-1",
            event: "recording.synced",
            payload: {
                event: "recording.synced",
                recording_id: "rec-1",
                delivered_at: now.toISOString(),
            },
            status: "pending",
            attempts: 0,
            lastAttemptAt: null,
            nextAttemptAt: now,
            lastResponseStatus: null,
            lastResponseBody: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
        };
        const endpoint = {
            id: "endpoint-1",
            userId: "user-1",
            url: "http://example.com/webhook",
            secret: "encrypted:whsec_abcdefghijkl",
            events: ["recording.synced"],
            description: null,
            enabled: true,
            lastDeliveryAt: null,
            lastDeliveryStatus: null,
            createdAt: now,
            updatedAt: now,
        };

        const selectChain = {
            innerJoin: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn().mockResolvedValue([{ delivery, endpoint }]),
        };
        selectChain.innerJoin.mockReturnValue(selectChain);
        selectChain.where.mockReturnValue(selectChain);
        selectChain.orderBy.mockReturnValue(selectChain);
        (db.select as Mock).mockReturnValue({
            from: vi.fn().mockReturnValue(selectChain),
        });

        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.transaction as Mock).mockImplementation(async (callback) => {
            await callback({
                update: vi.fn().mockReturnValue({
                    set: setSpy,
                }),
            });
        });

        await deliverDueWebhooks();

        expect(httpsRequest).not.toHaveBeenCalled();
        expect(getV1RecordingDetailForUser).not.toHaveBeenCalled();
        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "dead",
                lastError: "Webhook URL must use HTTPS",
            }),
        );
    });
});
