import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { ADMIN_HOSTNAME: undefined } }));
vi.mock("@/lib/hosted/hostname-gate", () => ({
    decideHostnameGate: vi.fn(),
}));

import { config } from "@/proxy";

/**
 * Middleware matcher should skip static JS assets (and other static
 * extensions) while still matching ordinary app and API routes.
 */
describe("proxy middleware matcher", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    it("excludes real static assets including .js", () => {
        expect(pattern.test("/favicon.ico")).toBe(false);
        expect(pattern.test("/robots.txt")).toBe(false);
        expect(pattern.test("/sitemap.xml")).toBe(false);
        expect(pattern.test("/some/asset.css")).toBe(false);
        expect(pattern.test("/some/asset.png")).toBe(false);
        expect(pattern.test("/some/asset.js")).toBe(false);
        expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    });

    it("still matches ordinary app/API routes", () => {
        expect(pattern.test("/admin/billing")).toBe(true);
        expect(pattern.test("/api/health")).toBe(true);
        expect(pattern.test("/dashboard")).toBe(true);
    });
});
