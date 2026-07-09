import { describe, expect, it } from "vitest";
import { isSuspended } from "@/lib/hosted/admin/suspension";

describe("isSuspended", () => {
    it("returns false for null/undefined user", () => {
        expect(isSuspended(null)).toBe(false);
        expect(isSuspended(undefined)).toBe(false);
    });

    it("returns false when suspendedAt is null", () => {
        expect(isSuspended({ suspendedAt: null })).toBe(false);
    });

    it("returns true when suspendedAt is a Date", () => {
        expect(isSuspended({ suspendedAt: new Date() })).toBe(true);
    });
});
