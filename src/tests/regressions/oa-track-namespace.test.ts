/**
 * @vitest-environment jsdom
 *
 * When another script already owns `window.oa`, Open Analytics installs
 * as `window.openanalytics`. `track()` must call that fallback, not the
 * occupied `window.oa` stub.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics/track";

afterEach(() => {
    delete window.oa;
    delete window.openanalytics;
});

describe("Open Analytics track() namespace fallback", () => {
    it("calls window.oa.track when it exists", () => {
        const oaTrack = vi.fn();
        window.oa = { track: oaTrack };
        track("hero_view", { location: "hero" });
        expect(oaTrack).toHaveBeenCalledWith("hero_view", { location: "hero" });
    });

    it("falls back to window.openanalytics when window.oa has no track", () => {
        const fallback = vi.fn();
        window.oa = {};
        window.openanalytics = { track: fallback };
        track("hero_view");
        expect(fallback).toHaveBeenCalledWith("hero_view", undefined);
    });

    it("does not throw when neither tracker is present", () => {
        expect(() => track("hero_view")).not.toThrow();
    });
});
