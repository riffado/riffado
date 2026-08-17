import { describe, expect, it } from "vitest";
import {
    applyFilenameOverrides,
    reconcileFilenameOverrides,
} from "@/lib/recordings/filename-overrides";

describe("filename overlays", () => {
    it("applies a pending overlay and yields to a refreshed server snapshot", () => {
        const recordings = [
            { id: "rec-1", filename: "Planning Call.m4a" },
            { id: "rec-2", filename: "Standup.m4a" },
        ];
        const overrides = new Map([["rec-1", "local-inline-rename.m4a"]]);

        expect(applyFilenameOverrides(recordings, overrides)[0].filename).toBe(
            "local-inline-rename.m4a",
        );

        const refreshed = [
            { id: "rec-1", filename: "plaud-other-client-name.m4a" },
            { id: "rec-2", filename: "Standup.m4a" },
        ];
        const reconciled = reconcileFilenameOverrides(refreshed, overrides);
        expect(reconciled.size).toBe(0);
        expect(applyFilenameOverrides(refreshed, reconciled)[0].filename).toBe(
            "plaud-other-client-name.m4a",
        );
    });

    it("drops the overlay even when the snapshot filename matches the local rename", () => {
        const overrides = new Map([["rec-1", "Q4 planning"]]);
        const snapshot = [{ id: "rec-1", filename: "Q4 planning" }];
        expect(reconcileFilenameOverrides(snapshot, overrides).size).toBe(0);
    });

    it("keeps the overlay Map identity when there is nothing to drop", () => {
        const empty = new Map<string, string>();
        expect(reconcileFilenameOverrides([{ id: "rec-1" }], empty)).toBe(
            empty,
        );
    });

    it("returns the original recordings array when no overlays exist", () => {
        const recordings = [{ id: "rec-1", filename: "A" }];
        expect(applyFilenameOverrides(recordings, new Map())).toBe(recordings);
    });
});
