import { describe, expect, it } from "vitest";
import {
    formatRecordingDateTimeRange,
    formatRowTime,
    formatSyncedAgo,
} from "@/lib/format-date";

describe("formatRecordingDateTimeRange", () => {
    it("shows the recorded date with start and end times", () => {
        const start = new Date(2026, 8, 7, 11, 27);

        expect(formatRecordingDateTimeRange(start, 25 * 60 * 1000)).toBe(
            "Sep 7, 2026 · 11:27 AM–11:52 AM",
        );
    });

    it("shows both dates when a recording crosses midnight", () => {
        const start = new Date(2026, 8, 7, 23, 50);

        expect(formatRecordingDateTimeRange(start, 20 * 60 * 1000)).toBe(
            "Sep 7, 2026 · 11:50 PM–Sep 8, 2026 · 12:10 AM",
        );
    });
});

describe("formatSyncedAgo", () => {
    const now = new Date(2026, 10, 22, 12, 0).getTime();
    const ago = (ms: number) => formatSyncedAgo(new Date(now - ms), now);

    it("reads under a minute as just now", () => {
        expect(ago(30_000)).toBe("just now");
        expect(ago(-5_000)).toBe("just now");
    });

    it("counts minutes, hours and days", () => {
        expect(ago(4 * 60_000)).toBe("4 min ago");
        expect(ago(60 * 60_000)).toBe("1 hour ago");
        expect(ago(5 * 60 * 60_000)).toBe("5 hours ago");
        expect(ago(24 * 60 * 60_000)).toBe("1 day ago");
        expect(ago(2 * 24 * 60 * 60_000)).toBe("2 days ago");
    });

    it("returns an empty string for an invalid date", () => {
        expect(formatSyncedAgo(new Date("nope"), now)).toBe("");
    });
});

describe("formatRowTime", () => {
    const now = new Date(2026, 10, 22, 12, 0);

    it("shows the time of day for today and yesterday", () => {
        expect(formatRowTime(new Date(2026, 10, 22, 9, 12), now)).toBe("09:12");
        expect(formatRowTime(new Date(2026, 10, 21, 16, 5), now)).toBe("16:05");
    });

    it("shows the weekday for the rest of the week", () => {
        expect(formatRowTime(new Date(2026, 10, 17, 8, 47), now)).toBe("Tue");
    });

    it("shows the date for older recordings", () => {
        expect(formatRowTime(new Date(2026, 9, 3, 10, 0), now)).toBe("Oct 3");
        expect(formatRowTime(new Date(2025, 9, 3, 10, 0), now)).toBe(
            "Oct 3, 2025",
        );
    });
});
