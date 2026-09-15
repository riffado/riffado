import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { ADMIN_HOSTNAME: undefined } }));
vi.mock("@/lib/hosted/hostname-gate", () => ({
    decideHostnameGate: vi.fn(),
}));

import { config } from "@/proxy";

/**
 * Middleware matcher should skip static assets while still matching
 * ordinary app/API routes and the PostHog same-origin JS handlers
 * (`/psthg/static/*`, `/psthg/array/*`) so ADMIN_HOSTNAME isolation
 * still runs for those paths.
 */
describe("proxy middleware matcher", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    it("excludes real static assets", () => {
        expect(pattern.test("/favicon.ico")).toBe(false);
        expect(pattern.test("/robots.txt")).toBe(false);
        expect(pattern.test("/sitemap.xml")).toBe(false);
        expect(pattern.test("/some/asset.css")).toBe(false);
        expect(pattern.test("/some/asset.png")).toBe(false);
        expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    });

    it("still matches PostHog JS proxy routes and ordinary app/API routes", () => {
        expect(pattern.test("/psthg/static/array.js")).toBe(true);
        expect(pattern.test("/psthg/array/recorder.js")).toBe(true);
        expect(pattern.test("/admin/billing")).toBe(true);
        expect(pattern.test("/api/health")).toBe(true);
        expect(pattern.test("/dashboard")).toBe(true);
    });
});
