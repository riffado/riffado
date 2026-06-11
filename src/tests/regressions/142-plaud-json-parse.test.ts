// Regression for issue #142: non-JSON Plaud response must produce a
// typed `AppError`, not a raw `SyntaxError`.

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
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { AppError, ErrorCode } from "@/lib/errors";
import { plaudSendCode, plaudVerifyOtp } from "@/lib/plaud/auth";
import {
    listPlaudWorkspaces,
    mintPlaudWorkspaceToken,
} from "@/lib/plaud/workspace";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

beforeEach(() => {
    mockFetch.mockReset();
});

const API_BASE = "https://api-euc1.plaud.ai";
const HTML_BODY =
    "<!DOCTYPE html><html><head><title>Blocked</title></head><body>...</body></html>";

function mockHtml403() {
    return {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: { get: () => null },
        text: () => Promise.resolve(HTML_BODY),
        json: () =>
            Promise.reject(
                new SyntaxError(
                    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
                ),
            ),
    };
}

function mock200Html() {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        text: () => Promise.resolve(HTML_BODY),
        json: () =>
            Promise.reject(
                new SyntaxError(
                    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
                ),
            ),
    };
}

describe("issue #142: non-JSON Plaud response → structured AppError", () => {
    it("plaudSendCode on 403 HTML body throws PLAUD_API_ERROR, not SyntaxError", async () => {
        mockFetch.mockResolvedValueOnce(mockHtml403());
        await expect(
            plaudSendCode("user@example.com", API_BASE),
        ).rejects.toMatchObject({
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
            statusCode: 400,
            details: expect.objectContaining({
                plaudStatus: 403,
                bodySnippet: expect.stringContaining("<!DOCTYPE"),
            }),
        });
    });

    it("plaudSendCode on 200 with HTML body throws PLAUD_UPSTREAM_ERROR", async () => {
        mockFetch.mockResolvedValueOnce(mock200Html());
        try {
            await plaudSendCode("user@example.com", API_BASE);
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe(ErrorCode.PLAUD_UPSTREAM_ERROR);
            expect((err as AppError).statusCode).toBe(502);
        }
    });

    it("plaudVerifyOtp on 403 HTML body throws PLAUD_API_ERROR, not SyntaxError", async () => {
        mockFetch.mockResolvedValueOnce(mockHtml403());
        await expect(
            plaudVerifyOtp("123456", "otp.token", API_BASE),
        ).rejects.toMatchObject({
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
            statusCode: 400,
        });
    });

    it("listPlaudWorkspaces on 403 HTML body throws PLAUD_API_ERROR", async () => {
        mockFetch.mockResolvedValueOnce(mockHtml403());
        await expect(
            listPlaudWorkspaces("ut.token", API_BASE),
        ).rejects.toMatchObject({
            name: "AppError",
            code: ErrorCode.PLAUD_API_ERROR,
        });
    });

    it("mintPlaudWorkspaceToken on 403 HTML body throws WorkspaceTokenError", async () => {
        mockFetch.mockResolvedValueOnce(mockHtml403());
        await expect(
            mintPlaudWorkspaceToken("ut.token", "ws_x", API_BASE),
        ).rejects.toMatchObject({
            name: "WorkspaceTokenError",
        });
    });
});
