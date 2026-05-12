import { describe, expect, it } from "vitest";
import { formatDuration, formatTimeLike } from "../lib/format-duration";

describe("formatDuration", () => {
    it("collapses non-finite / negative inputs", () => {
        expect(formatDuration(Number.NaN)).toBe("0:00");
        expect(formatDuration(-5)).toBe("0:00");
    });

    it("uses M:SS under an hour", () => {
        expect(formatDuration(0)).toBe("0:00");
        expect(formatDuration(42)).toBe("0:42");
        expect(formatDuration(323)).toBe("5:23");
    });

    it("switches to H:MM:SS at the hour boundary", () => {
        expect(formatDuration(3599)).toBe("59:59");
        expect(formatDuration(3600)).toBe("1:00:00");
        expect(formatDuration(3923)).toBe("1:05:23");
    });
});

describe("formatTimeLike", () => {
    it("falls back to formatDuration when reference is unknown", () => {
        expect(formatTimeLike(42, 0)).toBe("0:42");
        expect(formatTimeLike(42, Number.NaN)).toBe("0:42");
        expect(formatTimeLike(42, -1)).toBe("0:42");
    });

    it("keeps M:SS when reference is under 10 minutes", () => {
        expect(formatTimeLike(0, 323)).toBe("0:00");
        expect(formatTimeLike(42, 323)).toBe("0:42");
        expect(formatTimeLike(323, 323)).toBe("5:23");
    });

    it("zero-pads minutes when reference is >= 10 minutes", () => {
        expect(formatTimeLike(0, 1500)).toBe("00:00");
        expect(formatTimeLike(42, 1500)).toBe("00:42");
        expect(formatTimeLike(323, 1500)).toBe("05:23");
        expect(formatTimeLike(1499, 1500)).toBe("24:59");
    });

    it("pads to H:MM:SS when reference crosses the hour", () => {
        // ref 1:12:38 -> single-digit hours
        const ref = 1 * 3600 + 12 * 60 + 38;
        expect(formatTimeLike(0, ref)).toBe("0:00:00");
        expect(formatTimeLike(10 * 60 + 13, ref)).toBe("0:10:13");
        expect(formatTimeLike(ref, ref)).toBe("1:12:38");
    });

    it("widens hour field for multi-digit hour references", () => {
        const ref = 12 * 3600; // 12:00:00
        expect(formatTimeLike(0, ref)).toBe("00:00:00");
        expect(formatTimeLike(5 * 60 + 23, ref)).toBe("00:05:23");
        expect(formatTimeLike(ref, ref)).toBe("12:00:00");
    });

    it("does not truncate current when it overflows the reference", () => {
        // duration metadata may lag behind currentTime briefly.
        expect(formatTimeLike(3700, 1500)).toBe("1:01:40");
    });

    it("handles non-finite / negative current as zero", () => {
        expect(formatTimeLike(Number.NaN, 1500)).toBe("00:00");
        expect(formatTimeLike(-10, 3 * 3600)).toBe("0:00:00");
    });
});
