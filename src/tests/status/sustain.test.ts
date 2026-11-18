import { describe, expect, it, vi } from "vitest";

const { queriesMock } = vi.hoisted(() => ({
    queriesMock: {
        listStatusBuckets: vi.fn(),
        setStatusMinuteVerdict: vi.fn(),
    },
}));

vi.mock("@/db/queries/status", () => queriesMock);

import {
    memoryVerdictHistory,
    minuteFromReasons,
    postgresVerdictHistory,
    sustainedVerdict,
    sustainStatus,
    type VerdictHistory,
} from "@/lib/status/sustain";
import type { PartState, StatusResponse } from "@/lib/status/types";

const CONFIG = { windowMinutes: 7, badMinutes: 6 };

function raw(state: PartState, reason = `raw-${state}`): StatusResponse {
    return {
        part: "plaud",
        state,
        reason,
        latencyMs: 100,
        source: "traffic",
        window: { seconds: 300, requests: 10, errors: 0, p95Ms: 100 },
        checkedAt: "2026-11-18T10:00:00.000Z",
    };
}

const BASE = Date.parse("2026-11-18T10:00:00.000Z");
const at = (minute: number) => () => new Date(BASE + minute * 60_000);

describe("sustainedVerdict", () => {
    it("shows a bad raw verdict as transient ok until it is sustained", () => {
        const minutes = [
            { state: "down" as const, reason: "error-rate" },
            null,
            null,
        ];
        expect(
            sustainedVerdict(
                { state: "down", reason: "error-rate" },
                minutes,
                CONFIG,
            ),
        ).toEqual({ state: "ok", reason: "transient-error-rate" });
    });

    it("goes down once enough minutes in the window were down", () => {
        const down = { state: "down" as const, reason: "error-rate" };
        const minutes = [down, down, down, down, down, down, null];
        expect(sustainedVerdict(down, minutes, CONFIG)).toEqual(down);
    });

    it("goes slow when enough minutes were bad but not enough were down", () => {
        const slow = { state: "slow" as const, reason: "slow-p95" };
        const down = { state: "down" as const, reason: "error-rate" };
        const minutes = [down, slow, slow, slow, down, slow, null];
        expect(sustainedVerdict(down, minutes, CONFIG)).toEqual({
            state: "slow",
            reason: "error-rate",
        });
    });

    it("ignores minutes beyond the window", () => {
        const down = { state: "down" as const, reason: "x" };
        const ok = { state: "ok" as const, reason: "traffic-ok" };
        const minutes = [ok, down, down, down, down, down, ok, down, down];
        expect(sustainedVerdict(ok, minutes, CONFIG).state).toBe("ok");
    });
});

describe("minuteFromReasons", () => {
    it("takes the worst state checked in the minute", () => {
        expect(
            minuteFromReasons({ ok: "traffic-ok", slow: null, down: "x" }),
        ).toEqual({ state: "down", reason: "x" });
        expect(minuteFromReasons({ ok: null, slow: null, down: null })).toBe(
            null,
        );
    });
});

describe("postgresVerdictHistory", () => {
    it("records the verdict, then returns the window newest first with gaps as null", async () => {
        const minute = Math.floor(BASE / 60_000);
        queriesMock.setStatusMinuteVerdict.mockResolvedValue(undefined);
        queriesMock.listStatusBuckets.mockResolvedValue([
            {
                minute: new Date(minute * 60_000),
                verdictOk: null,
                verdictSlow: null,
                verdictDown: "error-rate",
            },
            {
                minute: new Date((minute - 2) * 60_000),
                verdictOk: "traffic-ok",
                verdictSlow: "slow-p95",
                verdictDown: null,
            },
        ]);
        const minutes = await postgresVerdictHistory.recordAndRead(
            "plaud",
            minute,
            { state: "down", reason: "error-rate" },
            4,
        );
        expect(queriesMock.setStatusMinuteVerdict).toHaveBeenCalledWith({
            part: "plaud",
            minute: new Date(minute * 60_000),
            state: "down",
            reason: "error-rate",
        });
        expect(queriesMock.listStatusBuckets).toHaveBeenCalledWith(
            "plaud",
            new Date((minute - 3) * 60_000),
        );
        expect(minutes).toEqual([
            { state: "down", reason: "error-rate" },
            null,
            { state: "slow", reason: "slow-p95" },
            null,
        ]);
    });
});

describe("sustainStatus", () => {
    it("needs 6 bad minutes out of 7 to show down, then recovers", async () => {
        const history = memoryVerdictHistory();
        const states: PartState[] = [];
        for (let minute = 0; minute < 6; minute++) {
            const res = await sustainStatus(raw("down"), {
                history,
                config: CONFIG,
                now: at(minute),
            });
            states.push(res.state);
        }
        expect(states).toEqual(["ok", "ok", "ok", "ok", "ok", "down"]);

        const recovered = await sustainStatus(raw("ok"), {
            history,
            config: CONFIG,
            now: at(6),
        });
        expect(recovered.state).toBe("down");
        const later = await sustainStatus(raw("ok"), {
            history,
            config: CONFIG,
            now: at(7),
        });
        expect(later.state).toBe("ok");
    });

    it("counts a minute as bad when any check in it (any process) was bad", async () => {
        const history = memoryVerdictHistory();
        const config = { windowMinutes: 3, badMinutes: 2 };
        await sustainStatus(raw("down"), { history, config, now: at(0) });
        await sustainStatus(raw("ok"), { history, config, now: at(0) });
        const res = await sustainStatus(raw("down"), {
            history,
            config,
            now: at(1),
        });
        expect(res.state).toBe("down");
    });

    it("answers the raw verdict when the history fails (never hides an outage)", async () => {
        const broken: VerdictHistory = {
            recordAndRead: () => Promise.reject(new Error("db down")),
        };
        const res = await sustainStatus(raw("down", "metrics-unavailable"), {
            history: broken,
            config: CONFIG,
            now: at(0),
        });
        expect(res).toMatchObject({
            state: "down",
            reason: "metrics-unavailable",
        });
    });

    it("is off with badMinutes 1", async () => {
        const res = await sustainStatus(raw("slow"), {
            history: memoryVerdictHistory(),
            config: { windowMinutes: 5, badMinutes: 1 },
            now: at(0),
        });
        expect(res.state).toBe("slow");
    });
});
