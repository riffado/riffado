import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";
import { DEFAULT_PLAUD_API_BASE, PlaudClient } from "../lib/plaud/client";
import {
    DEFAULT_SERVER_KEY,
    isValidPlaudApiUrl,
    PLAUD_SERVERS,
    serverKeyFromApiBase,
} from "../lib/plaud/servers";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe("PlaudClient", () => {
    let client: PlaudClient;
    const mockBearerToken = "test-bearer-token";

    beforeEach(() => {
        client = new PlaudClient(mockBearerToken);
        // mockReset wipes both call history AND queued one-shot returns,
        // so leftover mocks from prior tests don't leak in. clearAllMocks
        // (used previously) preserves queued returns, which breaks ordered
        // assertions when a synchronous test doesn't consume them.
        mockFetch.mockReset();
        // Each authenticated request first attempts to mint a workspace
        // token (WT) via /team-app/workspaces/list. For the endpoint-URL
        // assertions in this suite we don't care about the WT flow — we
        // queue a 500 so the client falls back to the user token, which
        // is what these tests assert against. Tests that exercise the WT
        // exchange explicitly live in regressions/66-eu-otp-permissions.
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: () => Promise.resolve({ status: 500, msg: "server error" }),
        });
    });

    describe("constructor", () => {
        it("should create client with bearer token", () => {
            expect(client).toBeInstanceOf(PlaudClient);
        });

        it("should use custom apiBase when provided", () => {
            const euClient = new PlaudClient(
                mockBearerToken,
                "https://api-euc1.plaud.ai",
            );
            expect(euClient).toBeInstanceOf(PlaudClient);
        });
    });

    describe("listDevices", () => {
        it("should make authenticated request to device list endpoint", async () => {
            const mockResponse = {
                status: 0,
                msg: "success",
                data_devices: [
                    {
                        sn: "888317426694681884",
                        name: "Test Device",
                        model: "888",
                        version_number: 131339,
                    },
                ],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            const result = await client.listDevices();

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/device/list`,
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${mockBearerToken}`,
                        "Content-Type": "application/json",
                    }),
                }),
            );
            expect(result).toEqual(mockResponse);
        });

        it("should use custom apiBase for requests", async () => {
            const euClient = new PlaudClient(
                mockBearerToken,
                "https://api-euc1.plaud.ai",
            );
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        status: 0,
                        msg: "success",
                        data_devices: [],
                    }),
            });

            await euClient.listDevices();

            expect(fetch).toHaveBeenCalledWith(
                "https://api-euc1.plaud.ai/device/list",
                expect.any(Object),
            );
        });
    });

    describe("getRecordings", () => {
        it("should make request with default parameters", async () => {
            const mockResponse = {
                status: 0,
                msg: "success",
                data_file_total: 0,
                data_file_list: [],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            const result = await client.getRecordings();

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/simple/web?skip=0&limit=99999&is_trash=0&sort_by=edit_time&is_desc=true`,
                expect.any(Object),
            );
            expect(result).toEqual(mockResponse);
        });

        it("should make request with custom parameters", async () => {
            const mockResponse = {
                status: 0,
                msg: "success",
                data_file_total: 0,
                data_file_list: [],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            await client.getRecordings(10, 50, 1, "create_time", false);

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/simple/web?skip=10&limit=50&is_trash=1&sort_by=create_time&is_desc=false`,
                expect.any(Object),
            );
        });
    });

    describe("getTempUrl", () => {
        it("should get temp URL for OPUS format by default", async () => {
            const mockResponse = {
                code: 0,
                msg: "success",
                data: {
                    temp_url: "https://example.com/audio.wav",
                    temp_url_opus: "https://example.com/audio.opus",
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            const result = await client.getTempUrl("file-123");

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/temp-url/file-123?is_opus=1`,
                expect.any(Object),
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get temp URL for WAV format when specified", async () => {
            const mockResponse = {
                code: 0,
                msg: "success",
                data: {
                    temp_url: "https://example.com/audio.wav",
                },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            await client.getTempUrl("file-123", false);

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/temp-url/file-123?is_opus=0`,
                expect.any(Object),
            );
        });
    });

    describe("testConnection", () => {
        it("should return true when connection is successful", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({ code: 0, msg: "success", data: {} }),
            });

            const result = await client.testConnection();
            expect(result).toBe(true);
        });

        it("should return false when connection fails", async () => {
            mockFetch.mockRejectedValueOnce(new Error("Network error"));

            const result = await client.testConnection();
            expect(result).toBe(false);
        });
    });

    describe("server key resolution", () => {
        it("should resolve known server keys to API base URLs", () => {
            expect(PLAUD_SERVERS.global.apiBase).toBe("https://api.plaud.ai");
            expect(PLAUD_SERVERS.eu.apiBase).toBe("https://api-euc1.plaud.ai");
        });

        it("should have global as the default server key", () => {
            expect(DEFAULT_SERVER_KEY).toBe("global");
        });

        it("should reject unknown server keys", () => {
            const unknownKey = "evil";
            expect(unknownKey in PLAUD_SERVERS).toBe(false);
        });
    });

    describe("isValidPlaudApiUrl", () => {
        it("should accept valid plaud.ai HTTPS URLs", () => {
            expect(isValidPlaudApiUrl("https://api.plaud.ai")).toBe(true);
            expect(isValidPlaudApiUrl("https://api-euc1.plaud.ai")).toBe(true);
            expect(isValidPlaudApiUrl("https://api-apse1.plaud.ai")).toBe(true);
            expect(isValidPlaudApiUrl("https://api-usw1.plaud.ai")).toBe(true);
        });

        it("should reject non-plaud domains", () => {
            expect(isValidPlaudApiUrl("https://evil.com")).toBe(false);
            expect(isValidPlaudApiUrl("https://plaud.ai.evil.com")).toBe(false);
            expect(isValidPlaudApiUrl("https://notplaud.ai")).toBe(false);
        });

        it("should reject non-HTTPS URLs", () => {
            expect(isValidPlaudApiUrl("http://api.plaud.ai")).toBe(false);
        });

        it("should reject invalid URLs", () => {
            expect(isValidPlaudApiUrl("")).toBe(false);
            expect(isValidPlaudApiUrl("not-a-url")).toBe(false);
        });
    });

    describe("serverKeyFromApiBase", () => {
        it("should return known keys for known URLs", () => {
            expect(serverKeyFromApiBase("https://api.plaud.ai")).toBe("global");
            expect(serverKeyFromApiBase("https://api-euc1.plaud.ai")).toBe(
                "eu",
            );
            expect(serverKeyFromApiBase("https://api-apse1.plaud.ai")).toBe(
                "apse1",
            );
        });

        it("should return 'custom' for unknown URLs", () => {
            expect(serverKeyFromApiBase("https://api-usw1.plaud.ai")).toBe(
                "custom",
            );
        });
    });

    describe("error handling", () => {
        it("should throw error when API returns error response", async () => {
            const errorResponse = {
                status: 400,
                msg: "Invalid request",
            };

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: () => Promise.resolve(errorResponse),
            });

            // Now throws a structured AppError(PLAUD_API_ERROR, msg="Invalid request", 400)
            await expect(client.listDevices()).rejects.toThrow(
                "Invalid request",
            );
        });

        it("should throw PLAUD_UPSTREAM_ERROR when fetch fails past retry budget", async () => {
            // Plain fetch failures (network blow-up, DNS, AbortError) past
            // our retry budget surface as PLAUD_UPSTREAM_ERROR (502) so
            // apiHandler doesn't downgrade them to a generic INTERNAL_ERROR
            // (500). The original message stays in server logs only.
            mockFetch.mockRejectedValue(new Error("Network error"));

            await expect(client.listDevices()).rejects.toThrow(
                /Failed to communicate with Plaud/,
            );
        });
    });
});
