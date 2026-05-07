import { describe, expect, it } from "vitest";
import { formatBytes } from "../lib/format-bytes";

describe("formatBytes", () => {
    it("returns 0 B for zero", () => {
        expect(formatBytes(0)).toBe("0 B");
    });

    it("clamps negative input to 0 B", () => {
        expect(formatBytes(-100)).toBe("0 B");
    });

    it("clamps non-finite input to 0 B", () => {
        expect(formatBytes(Number.NaN)).toBe("0 B");
        expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    });

    it("handles fractional byte inputs without falling off the unit table", () => {
        // Pre-fix this would compute a negative exponent and return
        // "NaN undefined" because units[-1] is undefined.
        expect(formatBytes(0.1)).toBe("0 B");
        expect(formatBytes(0.5)).toBe("1 B");
        expect(formatBytes(0.9)).toBe("1 B");
    });

    it("formats sub-KB sizes as integer bytes", () => {
        expect(formatBytes(1)).toBe("1 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1023)).toBe("1023 B");
    });

    it("formats KB with two decimals", () => {
        expect(formatBytes(1024)).toBe("1.00 KB");
        expect(formatBytes(1536)).toBe("1.50 KB");
    });

    it("formats MB with two decimals", () => {
        expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
        // 87.96 MB legacy fixture: 87.96 * 1024 * 1024 bytes
        expect(formatBytes(Math.round(87.96 * 1024 * 1024))).toBe("87.96 MB");
    });

    it("rolls over MB into GB at the binary boundary", () => {
        // 1234 MB worth of bytes -> 1.21 GB (binary)
        expect(formatBytes(1234 * 1024 * 1024)).toBe("1.21 GB");
        expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    });

    it("formats TB and clamps very large sizes to PB", () => {
        expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
        expect(formatBytes(1024 ** 5)).toBe("1.00 PB");
        // Beyond PB stays in PB rather than crashing or showing an unknown unit.
        expect(formatBytes(1024 ** 6)).toBe("1024.00 PB");
    });
});
