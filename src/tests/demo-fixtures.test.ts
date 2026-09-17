import { describe, expect, it } from "vitest";
import { buildDemoRecordings } from "@/lib/demo/fixtures";

describe("demo recording fixtures", () => {
    it("normalizes seed durations from seconds to recording milliseconds", () => {
        const recordings = buildDemoRecordings(
            new Date("2026-09-16T12:00:00.000Z"),
        );

        expect(recordings[0]?.duration).toBe((23 * 60 + 41) * 1000);
    });
});
