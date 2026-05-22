import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * Regression test for the manual POST /api/recordings/[id]/summary
 * endpoint after the refactor that extracted the heavy lifting into
 * `@/lib/summary/generate-summary`. The route is now a thin wrapper:
 *   1. require an API session
 *   2. read `preset` from the JSON body
 *   3. forward to `generateSummaryForRecording`
 *   4. echo the result as JSON
 *
 * This test pins the contract so a future refactor can't silently
 * change how presets propagate or how the response is shaped.
 */

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "u@example.com" },
    }),
}));

vi.mock("@/lib/summary/generate-summary", () => ({
    generateSummaryForRecording: vi.fn(),
}));

// `apiHandler` wraps the route in a try/catch that maps thrown
// AppErrors to status codes. We import the real implementation so any
// regression in error mapping also surfaces here, but we keep the
// dependencies the wrapper pulls in (db, encryption fields) mocked
// because this test doesn't exercise the GET / DELETE branches.
vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((v: string | null) => v),
    decryptJsonField: vi.fn(),
}));

import { POST } from "@/app/api/recordings/[id]/summary/route";
import { generateSummaryForRecording } from "@/lib/summary/generate-summary";

describe("POST /api/recordings/[id]/summary (manual)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeRequest(body: unknown): Request {
        return new Request("http://localhost/api/recordings/rec-1/summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    function makeContext(id = "rec-1") {
        return { params: Promise.resolve({ id }) };
    }

    it("forwards preset from body to generateSummaryForRecording", async () => {
        (generateSummaryForRecording as Mock).mockResolvedValue({
            summary: "ok",
            keyPoints: ["a", "b"],
            actionItems: ["x"],
            provider: "openai",
            model: "gpt-4o-mini",
        });

        const response = await POST(
            makeRequest({ preset: "meeting-notes" }),
            makeContext(),
        );

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual({
            summary: "ok",
            keyPoints: ["a", "b"],
            actionItems: ["x"],
            provider: "openai",
            model: "gpt-4o-mini",
        });
        expect(generateSummaryForRecording).toHaveBeenCalledWith(
            "user-1",
            "rec-1",
            { presetId: "meeting-notes" },
        );
    });

    it("passes presetId: undefined when body omits preset", async () => {
        (generateSummaryForRecording as Mock).mockResolvedValue({
            summary: "ok",
            keyPoints: [],
            actionItems: [],
            provider: "openai",
            model: "gpt-4o-mini",
        });

        await POST(makeRequest({}), makeContext());

        expect(generateSummaryForRecording).toHaveBeenCalledWith(
            "user-1",
            "rec-1",
            { presetId: undefined },
        );
    });

    it("tolerates a non-JSON body (parses to empty object)", async () => {
        (generateSummaryForRecording as Mock).mockResolvedValue({
            summary: "",
            keyPoints: [],
            actionItems: [],
            provider: "openai",
            model: "gpt-4o-mini",
        });

        const garbageRequest = new Request(
            "http://localhost/api/recordings/rec-1/summary",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "not-json{",
            },
        );

        const response = await POST(garbageRequest, makeContext());
        expect(response.status).toBe(200);
        expect(generateSummaryForRecording).toHaveBeenCalledWith(
            "user-1",
            "rec-1",
            { presetId: undefined },
        );
    });
});
