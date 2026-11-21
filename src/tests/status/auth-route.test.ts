import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
    handlers: {
        GET: vi.fn(async () => new Response(null, { status: 500 })),
        POST: vi.fn(async () => new Response(null, { status: 500 })),
    },
}));

vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => handlers }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/auth-rate-limit", () => ({
    enforceAuthRateLimit: vi.fn(async () => null),
}));

import { GET, POST } from "@/app/api/auth/[...all]/route";
import {
    drainPending,
    resetStatusRecorderForTests,
    setStatusRecordingEnabled,
} from "@/lib/status/record";

function signInCounts() {
    const buckets = drainPending().buckets.filter((b) => b.part === "sign-in");
    return {
        ok: buckets.reduce((n, b) => n + b.counts.ok, 0),
        err: buckets.reduce((n, b) => n + b.counts.err, 0),
    };
}

describe("sign-in status recording on /api/auth", () => {
    beforeEach(() => {
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
    });

    it("does not record GET requests (session reads on every page load)", async () => {
        const res = await GET(
            new Request("https://example.com/api/auth/get-session"),
        );
        expect(res.status).toBe(500);
        expect(signInCounts()).toEqual({ ok: 0, err: 0 });
    });

    it("records POST requests", async () => {
        await POST(
            new Request("https://example.com/api/auth/sign-in/email", {
                method: "POST",
            }),
        );
        expect(signInCounts()).toEqual({ ok: 0, err: 1 });
    });
});
