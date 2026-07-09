import { describe, expect, it } from "vitest";
import { isValidCalendarDateString } from "@/lib/date-validation";

describe("isValidCalendarDateString", () => {
    it("accepts real calendar dates", () => {
        expect(isValidCalendarDateString("2026-07-28")).toBe(true);
        expect(isValidCalendarDateString("2024-02-29")).toBe(true); // leap year
        expect(isValidCalendarDateString("2026-01-01")).toBe(true);
        expect(isValidCalendarDateString("2026-12-31")).toBe(true);
    });

    it("rejects a day that overflows the month (silently normalized by Date otherwise)", () => {
        expect(isValidCalendarDateString("2026-02-30")).toBe(false);
        expect(isValidCalendarDateString("2026-04-31")).toBe(false);
    });

    it("rejects a non-leap-year Feb 29", () => {
        expect(isValidCalendarDateString("2026-02-29")).toBe(false);
    });

    it("rejects an out-of-range month", () => {
        expect(isValidCalendarDateString("2026-13-01")).toBe(false);
        expect(isValidCalendarDateString("2026-00-01")).toBe(false);
    });

    it("rejects malformed shapes", () => {
        expect(isValidCalendarDateString("2026-7-28")).toBe(false);
        expect(isValidCalendarDateString("26-07-28")).toBe(false);
        expect(isValidCalendarDateString("not-a-date")).toBe(false);
        expect(isValidCalendarDateString("")).toBe(false);
    });
});
