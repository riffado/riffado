import { describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: { BACKGROUND_SYNC_INTERVAL_MS: 5 * 60_000 },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    INBOX_DOWN_AFTER_MS,
    INBOX_SLOW_AFTER_MS,
    jobPolicy,
    judgeInbox,
    judgeJob,
} from "@/lib/status/jobs";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function row(input: {
    lastSuccessAt?: Date | null;
    lastErrorAt?: Date | null;
    failingSince?: Date | null;
}) {
    return {
        lastSuccessAt: input.lastSuccessAt ?? null,
        lastErrorAt: input.lastErrorAt ?? null,
        failingSince: input.failingSince ?? null,
    };
}

describe("job policies", () => {
    it("derives sync thresholds from BACKGROUND_SYNC_INTERVAL_MS", () => {
        expect(jobPolicy("sync")).toEqual({
            kind: "loop",
            slowAfterMs: 15 * MIN,
            downAfterMs: 30 * MIN,
        });
        envMock.BACKGROUND_SYNC_INTERVAL_MS = 10 * MIN;
        expect(jobPolicy("sync").downAfterMs).toBe(60 * MIN);
        envMock.BACKGROUND_SYNC_INTERVAL_MS = 5 * MIN;
    });

    it("judges webhooks and billing-lapse as loops and auto-transcribe as event-driven", () => {
        expect(jobPolicy("webhooks")).toMatchObject({
            kind: "loop",
            slowAfterMs: 5 * MIN,
            downAfterMs: 15 * MIN,
        });
        expect(jobPolicy("billing-lapse")).toMatchObject({
            kind: "loop",
            slowAfterMs: 20 * MIN,
            downAfterMs: 45 * MIN,
        });
        expect(jobPolicy("auto-transcribe").kind).toBe("event");
    });
});

describe("loop job freshness", () => {
    const policy = jobPolicy("sync");

    it("is down when the job never succeeded", () => {
        expect(judgeJob(null, policy, NOW)).toEqual({
            state: "down",
            reason: "job-never-succeeded",
        });
        expect(
            judgeJob(row({ lastErrorAt: ago(MIN) }), policy, NOW).state,
        ).toBe("down");
    });

    it("is ok while the last success is fresh, also right at the slow threshold", () => {
        expect(
            judgeJob(row({ lastSuccessAt: ago(2 * MIN) }), policy, NOW),
        ).toEqual({ state: "ok", reason: "job-fresh" });
        expect(
            judgeJob(row({ lastSuccessAt: ago(15 * MIN) }), policy, NOW).state,
        ).toBe("ok");
    });

    it("is slow after the slow threshold and down after the down threshold", () => {
        expect(
            judgeJob(row({ lastSuccessAt: ago(16 * MIN) }), policy, NOW),
        ).toEqual({ state: "slow", reason: "job-stale" });
        expect(
            judgeJob(row({ lastSuccessAt: ago(31 * MIN) }), policy, NOW),
        ).toEqual({ state: "down", reason: "job-stale" });
    });

    it("ignores recent errors as long as successes keep coming", () => {
        expect(
            judgeJob(
                row({
                    lastSuccessAt: ago(MIN),
                    lastErrorAt: ago(10_000),
                    failingSince: ago(10_000),
                }),
                policy,
                NOW,
            ).state,
        ).toBe("ok");
    });
});

describe("event job freshness (auto-transcribe)", () => {
    const policy = jobPolicy("auto-transcribe");

    it("is ok when idle (never ran, nothing to do)", () => {
        expect(judgeJob(null, policy, NOW)).toEqual({
            state: "ok",
            reason: "job-idle",
        });
    });

    it("is ok however old the last success is", () => {
        expect(
            judgeJob(row({ lastSuccessAt: ago(48 * 60 * MIN) }), policy, NOW),
        ).toEqual({ state: "ok", reason: "job-ok" });
    });

    it("turns slow, then down, the longer every run keeps failing", () => {
        const failing = (ms: number) =>
            row({
                lastSuccessAt: ago(ms + MIN),
                lastErrorAt: ago(MIN),
                failingSince: ago(ms),
            });
        expect(judgeJob(failing(10 * MIN), policy, NOW)).toEqual({
            state: "ok",
            reason: "job-recent-errors",
        });
        expect(judgeJob(failing(31 * MIN), policy, NOW).state).toBe("slow");
        expect(judgeJob(failing(91 * MIN), policy, NOW)).toEqual({
            state: "down",
            reason: "job-failing",
        });
    });
});

describe("payments: Stripe webhook inbox", () => {
    it("is ok with an empty inbox", () => {
        expect(
            judgeInbox({ open: 0, oldestOpenAt: null, failedSince: 0 }, NOW),
        ).toEqual({ state: "ok", reason: "inbox-ok" });
    });

    it("judges the age of the oldest unfinished event", () => {
        const at = (ms: number) =>
            judgeInbox({ open: 3, oldestOpenAt: ago(ms), failedSince: 0 }, NOW);
        expect(at(4 * MIN).state).toBe("ok");
        expect(at(INBOX_SLOW_AFTER_MS + 1)).toEqual({
            state: "slow",
            reason: "inbox-backlog",
        });
        expect(at(INBOX_DOWN_AFTER_MS + 1)).toEqual({
            state: "down",
            reason: "inbox-backlog",
        });
    });

    it("is at least slow when an event failed permanently in the lookback", () => {
        expect(
            judgeInbox({ open: 0, oldestOpenAt: null, failedSince: 1 }, NOW),
        ).toEqual({ state: "slow", reason: "inbox-failed" });
        expect(
            judgeInbox(
                {
                    open: 1,
                    oldestOpenAt: ago(INBOX_DOWN_AFTER_MS + 1),
                    failedSince: 1,
                },
                NOW,
            ).state,
        ).toBe("down");
    });
});
