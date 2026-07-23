/**
 * Regression test for issue #231:
 *   "Plaud connect via connector crashes on undefined `c.data_devices` after
 *    'workspace discovery failed' (self-hosted v0.5.6)"
 *
 * Root cause: `PlaudClient.request()` only checked `response.ok` (HTTP
 * status), never Plaud's business-level `status` field on a 200 body. When
 * workspace-token mint fell back to the user token and `/device/list`
 * returned a 200 with an error-shaped body (no `data_devices`), the response
 * sailed through as "success" and `persist-connection.ts`'s
 * `for (const device of deviceList.data_devices)` threw an unhandled
 * `TypeError` on the undefined array, surfacing as a generic
 * "unexpected error" (err_<hash>) instead of an actionable message.
 *
 * The fix validates `status === 0` and `Array.isArray(data_devices)` inside
 * `PlaudClient.listDevices()` and throws a typed `PLAUD_API_ERROR` on a
 * malformed body instead of returning it as if it were valid.
 */

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

const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

import { AppError, ErrorCode } from "@/lib/errors";
import { PlaudClient } from "@/lib/plaud/client";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe("PlaudClient.listDevices — malformed response guard (#231)", () => {
    let client: PlaudClient;

    beforeEach(() => {
        client = new PlaudClient("test-user-token");
        mockFetch.mockReset();
        // Workspace-token mint fails first (matches the reported log:
        // "workspace discovery failed" -> falls back to the user token).
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: () => Promise.resolve({ status: 500, msg: "server error" }),
        });
    });

    it("throws a typed PLAUD_API_ERROR on a 200 body with no data_devices", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({ status: -1, msg: "session not authorized" }),
        });

        await expect(client.listDevices()).rejects.toMatchObject({
            code: ErrorCode.PLAUD_API_ERROR,
            statusCode: 400,
        });
    });

    it("throws a typed PLAUD_API_ERROR when data_devices is not an array", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({ status: 0, msg: "ok", data_devices: null }),
        });

        await expect(client.listDevices()).rejects.toBeInstanceOf(AppError);
    });

    it("still returns devices on a well-formed response", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    status: 0,
                    msg: "success",
                    data_devices: [
                        {
                            sn: "123",
                            name: "Device",
                            model: "888",
                            version_number: 1,
                        },
                    ],
                }),
        });

        const result = await client.listDevices();
        expect(result.data_devices).toHaveLength(1);
    });
});
