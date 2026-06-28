import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/lib/client.js";
import { USER_AGENT } from "../src/lib/version.js";

function jsonResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

describe("ApiClient", () => {
    it("sends Authorization and User-Agent headers", async () => {
        const fetchMock = vi.fn(
            async (_url: string | URL, init?: RequestInit) => {
                const headers = new Headers(init?.headers);
                expect(headers.get("authorization")).toBe("Bearer op_secret");
                expect(headers.get("user-agent")).toBe(USER_AGENT);
                return jsonResponse(200, { ok: true });
            },
        );

        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        const result = await client.request<{ ok: boolean }>(
            "/api/v1/recordings",
        );
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("decodes the unified error envelope and throws ApiError", async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse(404, {
                error: "Recording not found",
                code: "RECORDING_NOT_FOUND",
                details: { id: "rec_123" },
            }),
        );

        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
            maxRetries: 0,
        });

        await expect(
            client.request("/api/v1/recordings/rec_123"),
        ).rejects.toMatchObject({
            name: "ApiError",
            status: 404,
            code: "RECORDING_NOT_FOUND",
            message: "Recording not found",
            details: { id: "rec_123" },
        });
    });

    it("retries 429 honoring Retry-After (seconds form)", async () => {
        let call = 0;
        const fetchMock = vi.fn(async () => {
            call += 1;
            if (call === 1) {
                return jsonResponse(
                    429,
                    { error: "Rate limit exceeded", code: "RATE_LIMITED" },
                    { "Retry-After": "2" },
                );
            }
            return jsonResponse(200, { ok: true });
        });
        const sleepMock = vi.fn(async () => {});

        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
            sleep: sleepMock,
            maxRetries: 1,
        });
        const result = await client.request<{ ok: boolean }>(
            "/api/v1/recordings",
        );
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sleepMock).toHaveBeenCalledWith(2000);
    });

    it("gives up after maxRetries on persistent 429", async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse(
                429,
                { error: "Rate limit exceeded", code: "RATE_LIMITED" },
                { "Retry-After": "1" },
            ),
        );
        const sleepMock = vi.fn(async () => {});

        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
            sleep: sleepMock,
            maxRetries: 2,
        });
        await expect(
            client.request("/api/v1/recordings"),
        ).rejects.toBeInstanceOf(ApiError);
        // Initial attempt + 2 retries = 3 fetches.
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("falls back to a generic envelope when body is not JSON", async () => {
        const fetchMock = vi.fn(
            async () => new Response("<html>500</html>", { status: 500 }),
        );
        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
            maxRetries: 0,
        });
        await expect(
            client.request("/api/v1/recordings"),
        ).rejects.toMatchObject({
            status: 500,
            code: "UNKNOWN_ERROR",
        });
    });

    it("appends query parameters and skips undefined/null values", async () => {
        const fetchMock = vi.fn(async (url: string | URL) => {
            const parsed = new URL(url.toString());
            expect(parsed.searchParams.get("limit")).toBe("50");
            expect(parsed.searchParams.get("cursor")).toBe("abc");
            expect(parsed.searchParams.has("missing")).toBe(false);
            return jsonResponse(200, { data: [] });
        });
        const client = new ApiClient({
            server: "https://example.test",
            apiKey: "op_secret",
            fetchImpl: fetchMock as unknown as typeof fetch,
        });
        await client.request("/api/v1/recordings", {
            query: { limit: 50, cursor: "abc", missing: undefined },
        });
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
