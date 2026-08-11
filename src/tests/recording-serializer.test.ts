import { describe, expect, it } from "vitest";
import { serializeRecording } from "@/types/recording";

const base = {
    id: "rec-1",
    filename: "Planning Call",
    duration: 60_000,
    startTime: new Date("2026-05-06T12:00:00.000Z"),
    filesize: 1024,
    deviceSn: "SN-1",
    filetagId: null,
};

describe("serializeRecording", () => {
    it("propagates isLocalOnly when set", () => {
        expect(
            serializeRecording(base, { isLocalOnly: true }).isLocalOnly,
        ).toBe(true);
        expect(
            serializeRecording(base, { isLocalOnly: false }).isLocalOnly,
        ).toBe(false);
    });

    it("defaults isLocalOnly to false when flags are omitted", () => {
        expect(serializeRecording(base).isLocalOnly).toBe(false);
    });
});
