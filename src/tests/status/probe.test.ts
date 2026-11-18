import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createProbeCache,
    FAILED_PROBE_TTL_S,
    PROBE_PENDING_AFTER_MS,
} from "@/lib/status/probe";
import type { ProbeResult } from "@/lib/status/types";

const OK: ProbeResult = { state: "ok", reason: "probe-ok", latencyMs: 10 };
const DOWN: ProbeResult = {
    state: "down",
    reason: "probe-failed",
    latencyMs: null,
};

describe("probe cache", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reuses an ok result for the full TTL", async () => {
        let now = 0;
        const cache = createProbeCache(() => now);
        const fn = vi.fn(async () => OK);
        expect(await cache("storage", 300, fn)).toEqual(OK);
        now = 299_000;
        expect(await cache("storage", 300, fn)).toEqual(OK);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries a failed probe after a minute and serves the stale result meanwhile", async () => {
        let now = 0;
        const cache = createProbeCache(() => now);
        const fn = vi.fn().mockResolvedValueOnce(DOWN).mockResolvedValue(OK);
        expect(await cache("emails", 300, fn)).toEqual(DOWN);
        now = FAILED_PROBE_TTL_S * 1000 + 1;
        expect(await cache("emails", 300, fn)).toEqual(DOWN);
        await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
        expect(await cache("emails", 300, fn)).toEqual(OK);
    });

    it("turns a throwing probe into down probe-failed", async () => {
        const cache = createProbeCache(() => 0);
        const result = await cache("sign-in", 300, () =>
            Promise.reject(new Error("boom")),
        );
        expect(result).toEqual(DOWN);
    });

    it("answers probe-pending instead of waiting on a hanging first probe", async () => {
        vi.useFakeTimers();
        const cache = createProbeCache(() => 0);
        const pending = cache(
            "transcription",
            300,
            () => new Promise<ProbeResult>(() => undefined),
        );
        await vi.advanceTimersByTimeAsync(PROBE_PENDING_AFTER_MS);
        expect(await pending).toEqual({
            state: "down",
            reason: "probe-pending",
            latencyMs: null,
        });
    });

    it("runs one probe at a time per part", async () => {
        const cache = createProbeCache(() => 0);
        let resolve: (r: ProbeResult) => void = () => undefined;
        const fn = vi.fn(
            () =>
                new Promise<ProbeResult>((r) => {
                    resolve = r;
                }),
        );
        const a = cache("storage", 300, fn);
        const b = cache("storage", 300, fn);
        resolve(OK);
        expect(await Promise.all([a, b])).toEqual([OK, OK]);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
