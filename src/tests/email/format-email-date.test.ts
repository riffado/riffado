import { describe, expect, it } from "vitest";
import { formatEmailDate } from "@/lib/notifications/email-templates/format-date";

describe("formatEmailDate", () => {
    it("formats using a pinned UTC timezone regardless of process TZ", () => {
        // 23:30 UTC on Jan 31 -- in a negative-offset TZ (e.g. US Pacific,
        // UTC-8) this would render as Jan 31 locally; pinned to UTC it
        // must stay Jan 31 (still tests the pin holds, not a rollover).
        const d = new Date("2026-01-31T23:30:00Z");
        expect(formatEmailDate(d)).toBe("January 31, 2026");
    });

    it("does not roll over near a UTC day boundary", () => {
        const d = new Date("2026-03-01T00:15:00Z");
        expect(formatEmailDate(d)).toBe("March 1, 2026");
    });

    it("supports a short month for payment-failed's copy", () => {
        const d = new Date("2026-07-04T12:00:00Z");
        expect(formatEmailDate(d, { month: "short" })).toBe("Jul 4, 2026");
    });

    it("includes a pinned UTC time for the last-day deletion notice", () => {
        const d = new Date("2026-07-04T14:30:00Z");
        expect(formatEmailDate(d, { month: "short", includeTime: true })).toBe(
            "Jul 4, 2026, 2:30 PM UTC",
        );
    });
});
