/**
 * Regression coverage for `formatDate`/`formatRelative` receiving a
 * non-`Date` value at runtime.
 *
 * `src/db/queries/admin-billing.ts` (and the other raw `db.execute(sql\`...\`)`
 * admin queries) type their timestamp columns as `Date`, but that's a
 * compile-time annotation only -- nothing enforces it at runtime. When a
 * value reached these formatters as something other than a real `Date`
 * instance (e.g. an ISO string), `d.getTime()` / `d.toLocaleString()`
 * threw `TypeError: x.getTime is not a function` and crashed the whole
 * page (observed repeatedly on /admin/billing in production). These
 * formatters must coerce a parseable non-Date value instead of throwing,
 * and degrade to their "no value" fallback only for genuinely invalid
 * input.
 */

import { describe, expect, it } from "vitest";
import {
    formatDate,
    formatRelative,
} from "@/app/(hosted)/admin/(gated)/_components/metrics";

describe("formatRelative", () => {
    it("formats a real Date", () => {
        const d = new Date(Date.now() - 5 * 60_000);
        expect(formatRelative(d)).toBe("5m ago");
    });

    it("returns 'never' for null/undefined", () => {
        expect(formatRelative(null)).toBe("never");
        expect(formatRelative(undefined)).toBe("never");
    });

    it("coerces a parseable non-Date value (e.g. an ISO string) instead of throwing", () => {
        const isoString = new Date(Date.now() - 5 * 60_000).toISOString();
        // biome-ignore lint/suspicious/noExplicitAny: exercising a runtime type mismatch the `Date` prop type can't express
        expect(() => formatRelative(isoString as any)).not.toThrow();
        // biome-ignore lint/suspicious/noExplicitAny: exercising a runtime type mismatch the `Date` prop type can't express
        expect(formatRelative(isoString as any)).toBe("5m ago");
    });

    it("falls back to 'never' for an unparseable value instead of throwing", () => {
        const invalid = new Date("not-a-date");
        expect(() => formatRelative(invalid)).not.toThrow();
        expect(formatRelative(invalid)).toBe("never");
    });
});

describe("formatDate", () => {
    it("formats a real Date", () => {
        expect(formatDate(new Date("2026-07-22T12:00:00Z"))).toContain("2026");
    });

    it("returns an em dash for null/undefined", () => {
        expect(formatDate(null)).toBe("—");
        expect(formatDate(undefined)).toBe("—");
    });

    it("coerces a parseable non-Date value (e.g. an ISO string) instead of throwing", () => {
        const isoString = "2026-07-22T12:00:00Z";
        // biome-ignore lint/suspicious/noExplicitAny: exercising a runtime type mismatch the `Date` prop type can't express
        expect(() => formatDate(isoString as any)).not.toThrow();
        // biome-ignore lint/suspicious/noExplicitAny: exercising a runtime type mismatch the `Date` prop type can't express
        expect(formatDate(isoString as any)).toContain("2026");
    });

    it("falls back to an em dash for an unparseable value instead of throwing", () => {
        const invalid = new Date("not-a-date");
        expect(() => formatDate(invalid)).not.toThrow();
        expect(formatDate(invalid)).toBe("—");
    });
});
