import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, table } = vi.hoisted(() => ({
    envMock: { STATUS_TOKEN: "t".repeat(64) as string | undefined },
    table: new Map<
        string,
        {
            part: string;
            minute: Date;
            ok: number;
            err: number;
            latencyBuckets: number[];
        }
    >(),
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

vi.mock("@/db/queries/status", () => ({
    addStatusBucketCounts: vi.fn(
        async (input: {
            part: string;
            minute: Date;
            ok: number;
            err: number;
            latencyBuckets: number[];
        }) => {
            const key = `${input.part}:${input.minute.getTime()}`;
            const row = table.get(key);
            if (!row) {
                table.set(key, {
                    ...input,
                    latencyBuckets: [...input.latencyBuckets],
                });
                return;
            }
            row.ok += input.ok;
            row.err += input.err;
            const length = Math.max(
                row.latencyBuckets.length,
                input.latencyBuckets.length,
            );
            row.latencyBuckets = Array.from(
                { length },
                (_, i) =>
                    (row.latencyBuckets[i] ?? 0) +
                    (input.latencyBuckets[i] ?? 0),
            );
        },
    ),
    listStatusBuckets: vi.fn(async (part: string, since: Date) =>
        [...table.values()]
            .filter(
                (row) =>
                    row.part === part &&
                    row.minute.getTime() >= since.getTime(),
            )
            .map((row) => ({
                ...row,
                verdictOk: null,
                verdictSlow: null,
                verdictDown: null,
            })),
    ),
    mergeStatusJobRun: vi.fn(async () => undefined),
    pruneStatusBuckets: vi.fn(async () => undefined),
}));

import { mergeStatusJobRun } from "@/db/queries/status";
import {
    flushStatusRecorder,
    startStatusRecorder,
    stopStatusRecorderForTests,
} from "@/lib/status/flush";
import {
    drainPending,
    isStatusEnabled,
    recordJobFailure,
    recordJobSuccess,
    recordOutcome,
    resetStatusRecorderForTests,
    setStatusRecordingEnabled,
    trackCall,
} from "@/lib/status/record";
import { classify, LATENCY_BOUNDS_MS, p95 } from "@/lib/status/types";
import { readWindow } from "@/lib/status/window";

const NOW = Date.parse("2026-11-18T10:04:30.000Z");

describe("cross-process aggregation", () => {
    beforeEach(() => {
        table.clear();
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
        vi.clearAllMocks();
    });

    it("sums two processes' flushes of the same minute and computes p95 from the merged histogram", async () => {
        for (let i = 0; i < 18; i++) recordOutcome("plaud", true, 120, NOW);
        recordOutcome("plaud", false, 30_000, NOW);
        await flushStatusRecorder(new Date(NOW));

        for (let i = 0; i < 10; i++) recordOutcome("plaud", true, 300, NOW);
        recordOutcome("plaud", false, 45_000, NOW);
        await flushStatusRecorder(new Date(NOW));

        expect(table.size).toBe(1);
        const window = await readWindow("plaud", new Date(NOW));
        expect(window.ok).toBe(28);
        expect(window.err).toBe(2);
        expect(window.buckets[0]).toBe(18);
        expect(window.buckets[1]).toBe(10);
        expect(p95(window.buckets)).toBe(40_000);
        expect(p95(window.buckets, 2)).toBe(500);
        expect(window.buckets).toHaveLength(LATENCY_BOUNDS_MS.length + 1);
    });

    it("only one process seeing errors still shows in the shared window", async () => {
        for (let i = 0; i < 4; i++) recordOutcome("storage", false, 100, NOW);
        await flushStatusRecorder(new Date(NOW));
        for (let i = 0; i < 4; i++) recordOutcome("storage", true, 100, NOW);
        await flushStatusRecorder(new Date(NOW));

        const window = await readWindow("storage", new Date(NOW));
        expect(
            classify(window, {
                minRequests: 5,
                downErrorRate: 0.5,
                slowErrorRate: 0.1,
                slowP95Ms: 5000,
            }),
        ).toEqual({ state: "down", reason: "error-rate" });
    });

    it("sums minute buckets inside the 5-minute window and drops older ones", async () => {
        recordOutcome("emails", true, 100, NOW - 4 * 60_000);
        recordOutcome("emails", true, 100, NOW - 5 * 60_000);
        recordOutcome("emails", true, 100, NOW);
        await flushStatusRecorder(new Date(NOW));

        expect(table.size).toBe(3);
        const window = await readWindow("emails", new Date(NOW));
        expect(window.ok).toBe(2);
    });

    it("drains pending state on flush so nothing is counted twice", async () => {
        recordOutcome("sign-in", true, 100, NOW);
        await flushStatusRecorder(new Date(NOW));
        await flushStatusRecorder(new Date(NOW));
        const window = await readWindow("sign-in", new Date(NOW));
        expect(window.ok).toBe(1);
    });

    it("records nothing while recording is off", async () => {
        setStatusRecordingEnabled(false);
        recordOutcome("plaud", true, 100, NOW);
        recordJobSuccess("sync");
        const value = await trackCall(
            "plaud",
            async () => 7,
            () => "ok",
        );
        expect(value).toBe(7);
        expect(drainPending()).toEqual({ buckets: [], jobs: [] });
    });

    it("trackCall passes results and errors through and honors ignore", async () => {
        await expect(
            trackCall(
                "plaud",
                () => Promise.reject(new Error("boom")),
                () => "error",
            ),
        ).rejects.toThrow("boom");
        await trackCall(
            "plaud",
            async () => "x",
            () => "ignore",
        );
        const { buckets } = drainPending();
        expect(buckets).toHaveLength(1);
        expect(buckets[0].counts.ok).toBe(0);
        expect(buckets[0].counts.err).toBe(1);
    });

    it("trackCall with latency off records the outcome but not the duration", async () => {
        await trackCall(
            "storage",
            async () => "x",
            () => "ok",
            { latency: false },
        );
        await trackCall(
            "storage",
            async () => "y",
            () => "ok",
        );
        const { buckets } = drainPending();
        expect(buckets).toHaveLength(1);
        expect(buckets[0].counts.ok).toBe(2);
        expect(buckets[0].counts.buckets.reduce((a, b) => a + b, 0)).toBe(1);
    });
});

describe("startStatusRecorder", () => {
    beforeEach(() => {
        table.clear();
        resetStatusRecorderForTests();
        vi.useFakeTimers();
    });

    afterEach(() => {
        stopStatusRecorderForTests();
        envMock.STATUS_TOKEN = "t".repeat(64);
        vi.useRealTimers();
    });

    it("keeps recording off without STATUS_TOKEN and switches it on with one", () => {
        setStatusRecordingEnabled(false);
        envMock.STATUS_TOKEN = undefined;
        startStatusRecorder();
        expect(isStatusEnabled()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        envMock.STATUS_TOKEN = "t".repeat(64);
        startStatusRecorder();
        startStatusRecorder();
        expect(isStatusEnabled()).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
    });

    it("flushes once a minute until stopped", async () => {
        startStatusRecorder();
        recordOutcome("plaud", true, 100);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(table.size).toBe(1);

        stopStatusRecorderForTests();
        expect(vi.getTimerCount()).toBe(0);
        expect(isStatusEnabled()).toBe(false);
    });
});

describe("job outcome recording", () => {
    beforeEach(() => {
        resetStatusRecorderForTests();
        setStatusRecordingEnabled(true);
        vi.clearAllMocks();
    });

    it("tracks the failure streak since the last success seen in this process", () => {
        const t = (s: number) => new Date(NOW + s * 1000);
        recordJobFailure("auto-transcribe", t(0));
        recordJobFailure("auto-transcribe", t(10));
        recordJobSuccess("auto-transcribe", t(20));
        recordJobFailure("auto-transcribe", t(30));
        recordJobFailure("auto-transcribe", t(40));
        recordJobSuccess("sync", t(5));

        const { jobs } = drainPending();
        const auto = jobs.find((j) => j.job === "auto-transcribe");
        expect(auto).toEqual({
            job: "auto-transcribe",
            lastSuccessAt: t(20),
            lastErrorAt: t(40),
            failingFrom: t(30),
        });
        expect(jobs.find((j) => j.job === "sync")).toEqual({
            job: "sync",
            lastSuccessAt: t(5),
            lastErrorAt: null,
            failingFrom: null,
        });
    });

    it("flushes each job once per flush", async () => {
        recordJobSuccess("webhooks");
        recordJobSuccess("webhooks");
        await flushStatusRecorder(new Date(NOW));
        expect(mergeStatusJobRun).toHaveBeenCalledTimes(1);
        await flushStatusRecorder(new Date(NOW));
        expect(mergeStatusJobRun).toHaveBeenCalledTimes(1);
    });
});
