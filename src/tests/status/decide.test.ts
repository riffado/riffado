import { describe, expect, it, vi } from "vitest";
import { decideStatus, quietErrorVerdict } from "@/lib/status/decide";
import {
    bucketIndex,
    classify,
    emptyCounts,
    LATENCY_BOUNDS_MS,
    p95,
    type Thresholds,
    type WindowCounts,
} from "@/lib/status/types";

const T: Thresholds = {
    minRequests: 5,
    downErrorRate: 0.5,
    slowErrorRate: 0.1,
    slowP95Ms: 5000,
    downP95Ms: 20_000,
};

function counts(ok: number, err: number, latencyMs = 100): WindowCounts {
    const c = emptyCounts();
    c.ok = ok;
    c.err = err;
    c.buckets[bucketIndex(latencyMs)] = ok + err;
    return c;
}

describe("classify thresholds", () => {
    it("returns null below minRequests (never ok from too little traffic)", () => {
        expect(classify(counts(4, 0), T)).toBeNull();
    });

    it("is ok with enough fast, successful traffic", () => {
        expect(classify(counts(20, 0), T)).toEqual({
            state: "ok",
            reason: "traffic-ok",
        });
    });

    it("is down at the down error rate and slow at the slow error rate", () => {
        expect(classify(counts(5, 5), T)?.state).toBe("down");
        expect(classify(counts(9, 1), T)).toEqual({
            state: "slow",
            reason: "error-rate",
        });
        expect(classify(counts(19, 1), T)?.state).toBe("ok");
    });

    it("judges p95 latency against slowP95Ms and downP95Ms", () => {
        expect(classify(counts(10, 0, 8000), T)).toEqual({
            state: "slow",
            reason: "slow-p95",
        });
        expect(classify(counts(10, 0, 30_000), T)).toEqual({
            state: "down",
            reason: "slow-p95",
        });
    });

    it("ignores a lone error below minErrors and a lone slow call with ignoreSlowest", () => {
        const t = { ...T, minErrors: 2, ignoreSlowest: 1 };
        expect(classify(counts(5, 1), t)?.state).toBe("ok");
        const c = counts(6, 0, 100);
        c.buckets[bucketIndex(30_000)] += 1;
        c.ok += 1;
        expect(classify(c, t)?.state).toBe("ok");
        c.buckets[bucketIndex(30_000)] += 1;
        c.ok += 1;
        expect(classify(c, t)?.state).toBe("down");
    });
});

describe("p95 from the latency histogram", () => {
    it("is null without data", () => {
        expect(p95(emptyCounts().buckets)).toBeNull();
    });

    it("returns the upper bound of the bucket holding the 95th percentile", () => {
        const c = emptyCounts();
        c.buckets[bucketIndex(100)] = 95;
        c.buckets[bucketIndex(3000)] = 5;
        expect(p95(c.buckets)).toBe(250);
        c.buckets[bucketIndex(100)] = 94;
        expect(p95(c.buckets)).toBe(5000);
    });

    it("maps the overflow bucket to the last bound", () => {
        const c = emptyCounts();
        c.buckets[bucketIndex(10_000_000)] = 1;
        expect(p95(c.buckets)).toBe(LATENCY_BOUNDS_MS.at(-1));
    });
});

describe("quietErrorVerdict", () => {
    it("ignores a single error, is slow with some successes, down without", () => {
        expect(quietErrorVerdict(counts(0, 1))).toBeNull();
        expect(quietErrorVerdict(counts(1, 2))).toEqual({
            state: "slow",
            reason: "recent-errors",
        });
        expect(quietErrorVerdict(counts(0, 2))).toEqual({
            state: "down",
            reason: "recent-errors",
        });
    });
});

describe("decideStatus", () => {
    const now = () => new Date("2026-11-18T10:00:00.000Z");

    it("is down metrics-unavailable when the window can't be read", async () => {
        const probe = vi.fn();
        const res = await decideStatus("sign-in", {
            readWindow: () => Promise.reject(new Error("db down")),
            probe,
            thresholds: T,
            now,
            fallbackLatencyMs: () => 12,
        });
        expect(res).toMatchObject({
            state: "down",
            reason: "metrics-unavailable",
            latencyMs: 12,
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it("judges by traffic when there is enough, without probing", async () => {
        const probe = vi.fn();
        const res = await decideStatus("plaud", {
            readWindow: async () => counts(20, 0, 400),
            probe,
            thresholds: T,
            now,
        });
        expect(res).toMatchObject({
            state: "ok",
            source: "traffic",
            latencyMs: 500,
            window: { seconds: 300, requests: 20, errors: 0, p95Ms: 500 },
            checkedAt: "2026-11-18T10:00:00.000Z",
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it("probes a quiet window and reports the probe's latency", async () => {
        const res = await decideStatus("storage", {
            readWindow: async () => counts(1, 0),
            probe: async () => ({
                state: "ok",
                reason: "probe-ok",
                latencyMs: 42,
            }),
            thresholds: T,
            now,
        });
        expect(res).toMatchObject({
            state: "ok",
            reason: "probe-ok",
            source: "probe",
            latencyMs: 42,
        });
    });

    it("lets quiet-window errors beat an ok probe", async () => {
        const res = await decideStatus("emails", {
            readWindow: async () => counts(0, 2),
            probe: async () => ({
                state: "ok",
                reason: "probe-ok",
                latencyMs: 42,
            }),
            thresholds: T,
            now,
        });
        expect(res).toMatchObject({
            state: "down",
            reason: "recent-errors",
            source: "traffic",
        });
    });

    it("treats a throwing probe as down and falls back to a numeric latency", async () => {
        const res = await decideStatus("transcription", {
            readWindow: async () => emptyCounts(),
            probe: () => Promise.reject(new Error("boom")),
            thresholds: T,
            now,
            fallbackLatencyMs: () => 7,
        });
        expect(res).toMatchObject({
            state: "down",
            reason: "probe-failed",
            latencyMs: 7,
        });
    });
});
