import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
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

const mockEnv = vi.hoisted(() => ({
    APP_URL: "https://openplaud.example",
    IS_HOSTED: false,
    WEBHOOKS_REQUIRE_PUBLIC_TARGETS: undefined as boolean | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

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
        execute: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) => {
        if (!ciphertext.startsWith("encrypted:")) {
            throw new Error("Expected encrypted webhook value");
        }
        return ciphertext.replace(/^encrypted:/, "");
    }),
}));

vi.mock("@/lib/v1/serialize", () => ({
    getV1RecordingDetailForUser: vi.fn().mockResolvedValue({
        id: "rec-1",
        title: "Current Recording",
        created_at: "2026-05-06T11:59:00.000Z",
        updated_at: "2026-05-06T12:00:00.000Z",
        recorded_at: "2026-05-06T11:00:00.000Z",
        duration_ms: 120000,
        filesize_bytes: 12345,
        device: {
            serial_number: "SN-1",
            name: "Plaud Note",
            model: "Note",
        },
        has_transcription: true,
        has_summary: true,
        links: {
            self: "/api/v1/recordings/rec-1",
            transcript: "/api/v1/recordings/rec-1/transcript",
            audio: "/api/v1/recordings/rec-1/audio",
        },
        transcript: {
            language: "en",
            text: "x".repeat(600),
            provider: "openai",
            model: "whisper-1",
            created_at: "2026-05-06T12:00:00.000Z",
        },
        summary: { text: "Current summary" },
    }),
    serializeRecordingDetail: vi.fn((recording, device) => {
        const self = `/api/v1/recordings/${recording.id}`;
        return {
            id: recording.id,
            title: recording.filename,
            created_at: recording.createdAt.toISOString(),
            updated_at: recording.updatedAt.toISOString(),
            recorded_at: recording.startTime.toISOString(),
            duration_ms: recording.duration,
            filesize_bytes: recording.filesize,
            device: device
                ? {
                      serial_number: device.serialNumber,
                      name: device.name,
                      model: device.model,
                  }
                : null,
            has_transcription: false,
            has_summary: false,
            links: {
                self,
                transcript: `${self}/transcript`,
                audio: `${self}/audio`,
            },
            transcript: null,
            summary: null,
        };
    }),
}));

import { db } from "@/db";
import { recordings, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { getV1RecordingDetailForUser } from "@/lib/v1/serialize";
import {
    decryptWebhookSecret,
    decryptWebhookUrl,
    encryptWebhookSecret,
    maskStoredWebhookSecret,
} from "@/lib/webhooks/secrets";
import {
    createWebhookSignature,
    formatWebhookSignatureHeader,
    verifyWebhookSignature,
} from "@/lib/webhooks/signature";
import { parseWebhookUrl, resolveWebhookUrl } from "@/lib/webhooks/url";
import { deliverDueWebhooks, getWebhookBackoffMs } from "@/lib/webhooks/worker";

type MockClientRequest = EventEmitter & {
    write: Mock;
    end: Mock;
    destroy: Mock;
};

let lastMockRequest: MockClientRequest | null = null;

function mockNodeResponse(requestMock: Mock, statusCode: number, body: string) {
    requestMock.mockImplementation(
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

function deliveryRow(overrides: Record<string, unknown> = {}) {
    const now = new Date("2026-05-06T12:00:00.000Z");
    return {
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
        ...overrides,
    };
}

function endpointRow(overrides: Record<string, unknown> = {}) {
    const now = new Date("2026-05-06T12:00:00.000Z");
    return {
        id: "endpoint-1",
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

function mockLoadedDeliveries(rows: unknown[]) {
    const selectChain = {
        innerJoin: vi.fn(),
        where: vi.fn(),
    };
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockResolvedValue(rows);
    (db.select as Mock).mockReturnValueOnce({
        from: vi.fn().mockReturnValue(selectChain),
    });
}

function mockReloadedDelivery(row: unknown | null) {
    const selectChain = {
        innerJoin: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue(row ? [row] : []),
    };
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    (db.select as Mock).mockReturnValueOnce({
        from: vi.fn().mockReturnValue(selectChain),
    });
    return selectChain;
}

function mockDueDeliveries(
    rows: unknown[],
    options: { reloadRows?: Array<unknown | null> } = {},
) {
    (db.execute as Mock).mockResolvedValue(
        rows.map((row) => ({
            id: (row as { delivery: { id: string } }).delivery.id,
        })),
    );

    mockLoadedDeliveries(rows);

    const claimedRows = rows.map((row) => ({
        id: (row as { delivery: { id: string } }).delivery.id,
    }));
    (db.update as Mock).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue(claimedRows),
            }),
        }),
    });

    const reloadRows = options.reloadRows ?? rows;
    for (const reloadRow of reloadRows) {
        mockReloadedDelivery(reloadRow);
    }
}

function mockTombstonedRecording() {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const selectChain = {
        leftJoin: vi.fn(),
        where: vi.fn(),
        limit: vi.fn().mockResolvedValue([
            {
                recording: {
                    id: "rec-1",
                    filename: "Deleted Recording",
                    startTime: new Date("2026-05-06T11:00:00.000Z"),
                    duration: 120000,
                    filesize: 12345,
                    createdAt: new Date("2026-05-06T11:59:00.000Z"),
                    updatedAt: now,
                    deletedAt: now,
                },
                device: {
                    serialNumber: "SN-1",
                    name: "Plaud Note",
                    model: "Note",
                },
            },
        ]),
    };
    selectChain.leftJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    (db.select as Mock).mockReturnValueOnce({
        from: vi.fn().mockReturnValue(selectChain),
    });
    return selectChain;
}

function mockSuccessfulUpdates() {
    const updateChain = {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: "delivery-1" }]),
            }),
        }),
    };
    (db.transaction as Mock).mockImplementation(async (callback) => {
        await callback({
            update: vi.fn().mockReturnValue(updateChain),
        });
    });
    return updateChain;
}

function exprReferencesColumn(
    expr: unknown,
    col: unknown,
    seen = new Set<unknown>(),
): boolean {
    if (expr == null || typeof expr !== "object") return false;
    if (expr === col) return true;
    if (seen.has(expr)) return false;
    seen.add(expr);

    for (const key of [
        "queryChunks",
        "sql",
        "left",
        "right",
        "value",
        "args",
        "chunks",
        "expr",
    ]) {
        const value = (expr as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
            if (value.some((item) => exprReferencesColumn(item, col, seen))) {
                return true;
            }
        } else if (exprReferencesColumn(value, col, seen)) {
            return true;
        }
    }

    return false;
}

function countExprColumnRefs(
    expr: unknown,
    col: unknown,
    seen = new Set<unknown>(),
): number {
    if (expr == null || typeof expr !== "object") return 0;
    if (expr === col) return 1;
    if (seen.has(expr)) return 0;
    seen.add(expr);

    let count = 0;
    for (const value of Object.values(expr as Record<string, unknown>)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                count += countExprColumnRefs(item, col, seen);
            }
        } else {
            count += countExprColumnRefs(value, col, seen);
        }
    }
    return count;
}

function collectStringChunks(
    value: unknown,
    seen = new Set<unknown>(),
): string {
    if (typeof value === "string") return value;
    if (value == null || typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => collectStringChunks(item, seen)).join(" ");
    }

    return Object.values(value as Record<string, unknown>)
        .map((item) => collectStringChunks(item, seen))
        .join(" ");
}

function normalizedSqlText(value: unknown): string {
    return collectStringChunks(value).replace(/\s+/g, " ").toLowerCase();
}

describe("webhooks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEnv.APP_URL = "https://openplaud.example";
        mockEnv.IS_HOSTED = false;
        mockEnv.WEBHOOKS_REQUIRE_PUBLIC_TARGETS = undefined;
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

    it("claims candidates with per-user fair-share ranking", async () => {
        let query: unknown;
        (db.execute as Mock).mockImplementation((sqlQuery: unknown) => {
            query = sqlQuery;
            return Promise.resolve([]);
        });

        await deliverDueWebhooks();

        const text = normalizedSqlText(query);
        expect(text).toContain("row_number() over");
        expect(text).toContain("partition by");
        expect(text).toContain("user_rank <=");
    });

    it("rechecks due time when claiming selected deliveries", async () => {
        let whereExpr: unknown;
        (db.execute as Mock).mockResolvedValue([{ id: "delivery-1" }]);
        (db.update as Mock).mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
                where: vi.fn((expr: unknown) => {
                    whereExpr = expr;
                    return {
                        returning: vi.fn().mockResolvedValue([]),
                    };
                }),
            }),
        });

        await deliverDueWebhooks();

        expect(
            countExprColumnRefs(whereExpr, webhookDeliveries.nextAttemptAt),
        ).toBeGreaterThanOrEqual(2);
    });

    it("rechecks endpoint enablement when claiming and loading selected deliveries", async () => {
        let claimWhereExpr: unknown;
        let loadWhereExpr: unknown;
        (db.execute as Mock).mockResolvedValue([{ id: "delivery-1" }]);
        (db.update as Mock).mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
                where: vi.fn((expr: unknown) => {
                    claimWhereExpr = expr;
                    return {
                        returning: vi
                            .fn()
                            .mockResolvedValue([{ id: "delivery-1" }]),
                    };
                }),
            }),
        });

        const selectChain = {
            innerJoin: vi.fn(),
            where: vi.fn((expr: unknown) => {
                loadWhereExpr = expr;
                return Promise.resolve([]);
            }),
        };
        selectChain.innerJoin.mockReturnValue(selectChain);
        (db.select as Mock).mockReturnValueOnce({
            from: vi.fn().mockReturnValue(selectChain),
        });

        await deliverDueWebhooks();

        expect(normalizedSqlText(claimWhereExpr)).toContain("enabled");
        expect(
            exprReferencesColumn(loadWhereExpr, webhookEndpoints.enabled),
        ).toBe(true);
    });

    it("allows self-host HTTP and local targets without DNS pinning by default", () => {
        expect(() => parseWebhookUrl("http://n8n:5678/webhook")).not.toThrow();
        expect(() => parseWebhookUrl("http://127.0.0.1/hook")).not.toThrow();
        expect(() =>
            parseWebhookUrl("https://listener.local/hook"),
        ).not.toThrow();
        expect(() =>
            parseWebhookUrl("http://user:pass@n8n:5678/webhook"),
        ).toThrow("Webhook URL must not include credentials");
        expect(() => parseWebhookUrl("ftp://example.com/webhook")).toThrow(
            "Webhook URL must use HTTP or HTTPS",
        );
    });

    it("enforces HTTPS and public targets when hosted defaults strict", async () => {
        mockEnv.IS_HOSTED = true;
        expect(() =>
            parseWebhookUrl("https://example.com/webhook"),
        ).not.toThrow();
        expect(() => parseWebhookUrl("http://example.com/webhook")).toThrow(
            "Webhook URL must use HTTPS",
        );
        expect(() => parseWebhookUrl("https://localhost:3000/hook")).toThrow(
            "Webhook URL must use a public hostname or IP address",
        );

        (lookup as unknown as Mock).mockResolvedValue([
            { address: "93.184.216.34", family: 4 },
        ]);
        await expect(
            resolveWebhookUrl("https://example.com/hook"),
        ).resolves.toMatchObject({
            addresses: [{ address: "93.184.216.34", family: 4 }],
        });
    });

    it("lets WEBHOOKS_REQUIRE_PUBLIC_TARGETS override IS_HOSTED", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.WEBHOOKS_REQUIRE_PUBLIC_TARGETS = false;
        expect(() => parseWebhookUrl("http://127.0.0.1/hook")).not.toThrow();

        mockEnv.IS_HOSTED = false;
        mockEnv.WEBHOOKS_REQUIRE_PUBLIC_TARGETS = true;
        expect(() => parseWebhookUrl("http://127.0.0.1/hook")).toThrow(
            "Webhook URL must use HTTPS",
        );
    });

    it("encrypts webhook secrets before storage and masks decrypted values", () => {
        const secret = "whsec_abcdefghijkl";
        const encrypted = encryptWebhookSecret(secret);

        expect(encrypted).toBe(`encrypted:${secret}`);
        expect(decryptWebhookSecret(encrypted)).toBe(secret);
        expect(() => decryptWebhookSecret(secret)).toThrow(
            "Expected encrypted webhook value",
        );
        expect(() => decryptWebhookUrl("https://example.com/webhook")).toThrow(
            "Expected encrypted webhook value",
        );
        expect(maskStoredWebhookSecret(encrypted)).toBe("whsec_****ijkl");
    });

    it("uses http.request and no pinned lookup in permissive mode", async () => {
        mockDueDeliveries([
            {
                delivery: deliveryRow(),
                endpoint: endpointRow({
                    url: "encrypted:http://n8n:5678/webhook",
                }),
            },
        ]);
        mockSuccessfulUpdates();
        mockNodeResponse(httpRequest as unknown as Mock, 204, "");

        await deliverDueWebhooks();

        expect(httpRequest).toHaveBeenCalledTimes(1);
        expect(httpsRequest).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
        const requestOptions = (httpRequest as unknown as Mock).mock
            .calls[0][0] as RequestOptions;
        expect(requestOptions.lookup).toBeUndefined();
        expect(requestOptions.hostname).toBe("n8n");

        const requestBody = JSON.parse(
            String(lastMockRequest?.write.mock.calls[0]?.[0] ?? "{}"),
        ) as {
            data?: {
                api_url?: string;
                links?: { transcript?: string };
                transcript?: {
                    text?: string;
                    preview?: string;
                    length?: number;
                };
            };
        };
        expect(requestBody.data?.api_url).toBe(
            "https://openplaud.example/api/v1/recordings/rec-1",
        );
        expect(requestBody.data?.links?.transcript).toBe(
            "https://openplaud.example/api/v1/recordings/rec-1/transcript",
        );
        expect(requestBody.data?.transcript).toMatchObject({
            preview: "x".repeat(500),
            truncated: true,
            length: 600,
        });
        expect(requestBody.data?.transcript).not.toHaveProperty("text");
    });

    it("re-checks endpoint state immediately before posting", async () => {
        mockDueDeliveries(
            [
                {
                    delivery: deliveryRow(),
                    endpoint: endpointRow({
                        url: "encrypted:http://n8n:5678/webhook",
                    }),
                },
            ],
            { reloadRows: [null] },
        );

        const releaseSetSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValueOnce({
            set: releaseSetSpy,
        });

        await deliverDueWebhooks();

        expect(httpRequest).not.toHaveBeenCalled();
        expect(httpsRequest).not.toHaveBeenCalled();
        expect(getV1RecordingDetailForUser).not.toHaveBeenCalled();
        expect(releaseSetSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "pending",
            }),
        );
    });

    it("uses https.request and pinned lookup in strict mode", async () => {
        mockEnv.WEBHOOKS_REQUIRE_PUBLIC_TARGETS = true;
        (lookup as unknown as Mock).mockResolvedValue([
            { address: "93.184.216.34", family: 4 },
        ]);
        mockDueDeliveries([
            {
                delivery: deliveryRow(),
                endpoint: endpointRow({
                    url: "encrypted:https://example.com/webhook",
                }),
            },
        ]);
        mockSuccessfulUpdates();
        mockNodeResponse(httpsRequest as unknown as Mock, 204, "");

        await deliverDueWebhooks();

        expect(httpsRequest).toHaveBeenCalledTimes(1);
        expect(httpRequest).not.toHaveBeenCalled();
        expect(getV1RecordingDetailForUser).toHaveBeenCalledWith(
            "user-1",
            "rec-1",
        );
        const requestOptions = (httpsRequest as unknown as Mock).mock
            .calls[0][0] as RequestOptions & { lookup: LookupFunction };
        expect(requestOptions.hostname).toBe("example.com");
        expect(requestOptions.lookup).toBeTypeOf("function");

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
        mockDueDeliveries([
            {
                delivery: deliveryRow(),
                endpoint: endpointRow({
                    url: "encrypted:https://93.184.216.34/webhook",
                }),
            },
        ]);
        mockSuccessfulUpdates();
        mockNodeResponse(httpsRequest as unknown as Mock, 302, "redirect");

        await deliverDueWebhooks();

        expect(httpsRequest).toHaveBeenCalledTimes(1);
    });

    it("re-checks stored endpoints against current strict policy before sending", async () => {
        mockEnv.WEBHOOKS_REQUIRE_PUBLIC_TARGETS = true;
        mockDueDeliveries([
            {
                delivery: deliveryRow(),
                endpoint: endpointRow({
                    url: "encrypted:http://example.com/webhook",
                }),
            },
        ]);

        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: "delivery-1" }]),
            }),
        });
        (db.transaction as Mock).mockImplementation(async (callback) => {
            await callback({
                update: vi.fn().mockReturnValue({
                    set: setSpy,
                }),
            });
        });

        await deliverDueWebhooks();

        expect(httpRequest).not.toHaveBeenCalled();
        expect(httpsRequest).not.toHaveBeenCalled();
        expect(getV1RecordingDetailForUser).not.toHaveBeenCalled();
        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "dead",
                lastError: "Webhook URL must use HTTPS",
            }),
        );
    });

    it("hydrates deleted recording webhooks from user-scoped tombstone metadata", async () => {
        const deletedAt = new Date("2026-05-06T12:00:00.000Z");
        mockDueDeliveries([
            {
                delivery: deliveryRow({
                    event: "recording.deleted",
                    payload: {
                        event: "recording.deleted",
                        recording_id: "rec-1",
                        delivered_at: deletedAt.toISOString(),
                    },
                }),
                endpoint: endpointRow({
                    url: "encrypted:http://n8n:5678/webhook",
                    events: ["recording.deleted"],
                }),
            },
        ]);
        const tombstoneSelect = mockTombstonedRecording();
        const updateChain = mockSuccessfulUpdates();
        mockNodeResponse(httpRequest as unknown as Mock, 204, "");

        await deliverDueWebhooks();

        expect(httpRequest).toHaveBeenCalledTimes(1);
        expect(getV1RecordingDetailForUser).not.toHaveBeenCalled();
        expect(tombstoneSelect.where).toHaveBeenCalled();
        const whereExpr = tombstoneSelect.where.mock.calls[0][0];
        expect(exprReferencesColumn(whereExpr, recordings.id)).toBe(true);
        expect(exprReferencesColumn(whereExpr, recordings.userId)).toBe(true);
        expect(exprReferencesColumn(whereExpr, recordings.deletedAt)).toBe(
            true,
        );
        const requestBody = JSON.parse(
            String(lastMockRequest?.write.mock.calls[0]?.[0] ?? "{}"),
        ) as {
            event?: string;
            data?: {
                id?: string;
                title?: string;
                deleted_at?: string;
                transcript?: unknown;
                summary?: unknown;
                api_url?: string;
                links?: { self?: string };
            };
        };

        expect(requestBody.event).toBe("recording.deleted");
        expect(requestBody.data).toMatchObject({
            id: "rec-1",
            title: "Deleted Recording",
            deleted_at: deletedAt.toISOString(),
            transcript: null,
            summary: null,
            api_url: "https://openplaud.example/api/v1/recordings/rec-1",
        });
        expect(requestBody.data?.links?.self).toBe(
            "https://openplaud.example/api/v1/recordings/rec-1",
        );
        expect(updateChain.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "success",
                attempts: 1,
                lastResponseStatus: 204,
                lastError: null,
            }),
        );
    });
});
