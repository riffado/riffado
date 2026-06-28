import { describe, expect, it } from "vitest";
import {
    formatBytes,
    formatDuration,
    formatTimestamp,
} from "../src/lib/output.js";

describe("formatDuration", () => {
    it("formats sub-hour durations as m:ss", () => {
        expect(formatDuration(0)).toBe("0:00");
        expect(formatDuration(1500)).toBe("0:02");
        expect(formatDuration(65_000)).toBe("1:05");
    });

    it("formats hour-plus durations as h:mm:ss", () => {
        expect(formatDuration(3_725_000)).toBe("1:02:05");
    });
});

describe("formatBytes", () => {
    it("scales binary units", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1024)).toBe("1.0 KB");
        expect(formatBytes(1_572_864)).toBe("1.5 MB");
        expect(formatBytes(2_147_483_648)).toBe("2.0 GB");
    });
});

describe("formatTimestamp", () => {
    it("returns the original string for unparseable input", () => {
        expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    });

    it("formats ISO with a space separator and no milliseconds", () => {
        expect(formatTimestamp("2025-01-02T03:04:05.678Z")).toBe(
            "2025-01-02 03:04:05Z",
        );
    });
});
