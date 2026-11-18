import { listStatusBuckets, setStatusMinuteVerdict } from "@/db/queries/status";
import {
    type PartState,
    SEVERITY,
    type StatusPart,
    type StatusResponse,
    type Verdict,
} from "./types";

export interface SustainConfig {
    /** Minutes looked back, this one included. */
    windowMinutes: number;
    /** Bad minutes within the window before slow/down shows. 1 = off. */
    badMinutes: number;
}

/** The worst check of one minute; null when nothing checked that minute. */
export type MinuteVerdict = Verdict | null;

/**
 * Pure rule. `minutes` holds the window newest first, the current minute
 * (with `raw` already in it) at index 0. Down when at least `badMinutes`
 * minutes were down; slow when at least `badMinutes` were slow or down;
 * otherwise ok, with reason `transient-<raw reason>` for an unsustained bad
 * check. A minute without a check counts as good.
 */
export function sustainedVerdict(
    raw: Verdict,
    minutes: MinuteVerdict[],
    config: SustainConfig,
): Verdict {
    const window = minutes.slice(0, config.windowMinutes);
    const down = window.filter((m) => m?.state === "down");
    const bad = window.filter((m) => m && m.state !== "ok");
    if (down.length >= config.badMinutes) {
        return {
            state: "down",
            reason:
                raw.state === "down"
                    ? raw.reason
                    : (down[0]?.reason ?? raw.reason),
        };
    }
    if (bad.length >= config.badMinutes) {
        return {
            state: "slow",
            reason:
                raw.state !== "ok"
                    ? raw.reason
                    : (bad[0]?.reason ?? raw.reason),
        };
    }
    if (raw.state !== "ok") {
        return { state: "ok", reason: `transient-${raw.reason}` };
    }
    return raw;
}

/** Worst state of a minute's stored verdict reasons. */
export function minuteFromReasons(reasons: {
    ok: string | null;
    slow: string | null;
    down: string | null;
}): MinuteVerdict {
    let worst: MinuteVerdict = null;
    for (const state of ["ok", "slow", "down"] as const) {
        const reason = reasons[state];
        if (reason === null) continue;
        if (!worst || SEVERITY[state] > SEVERITY[worst.state]) {
            worst = { state, reason };
        }
    }
    return worst;
}

/** Where the per-minute raw verdicts live. */
export interface VerdictHistory {
    /** Add `verdict` to `minute`, then return the last `count` minutes, newest first. */
    recordAndRead(
        part: StatusPart,
        minute: number,
        verdict: Verdict,
        count: number,
    ): Promise<MinuteVerdict[]>;
}

/** Postgres-backed history in the minute bucket rows; shared by all processes. */
export const postgresVerdictHistory: VerdictHistory = {
    async recordAndRead(part, minute, verdict, count) {
        await setStatusMinuteVerdict({
            part,
            minute: new Date(minute * 60_000),
            state: verdict.state,
            reason: verdict.reason,
        });
        const rows = await listStatusBuckets(
            part,
            new Date((minute - count + 1) * 60_000),
        );
        const byMinute = new Map<number, MinuteVerdict>();
        for (const row of rows) {
            byMinute.set(
                Math.floor(row.minute.getTime() / 60_000),
                minuteFromReasons({
                    ok: row.verdictOk,
                    slow: row.verdictSlow,
                    down: row.verdictDown,
                }),
            );
        }
        return Array.from(
            { length: count },
            (_, i) => byMinute.get(minute - i) ?? null,
        );
    },
};

/** In-memory history, for tests. */
export function memoryVerdictHistory(): VerdictHistory {
    const minutes = new Map<string, Partial<Record<PartState, string>>>();
    const key = (part: StatusPart, minute: number) => `${part}:${minute}`;
    return {
        async recordAndRead(part, minute, verdict, count) {
            const k = key(part, minute);
            minutes.set(k, {
                ...(minutes.get(k) ?? {}),
                [verdict.state]: verdict.reason,
            });
            return Array.from({ length: count }, (_, i) => {
                const m = minutes.get(key(part, minute - i));
                return m
                    ? minuteFromReasons({
                          ok: m.ok ?? null,
                          slow: m.slow ?? null,
                          down: m.down ?? null,
                      })
                    : null;
            });
        },
    };
}

export interface SustainDeps {
    history: VerdictHistory;
    config: SustainConfig;
    now?: () => Date;
}

/**
 * Record `raw` and answer the sustained verdict. Everything else in the
 * response stays as `raw` has it. When the history can't be written or
 * read, `raw` is answered unchanged so an outage is never hidden.
 */
export async function sustainStatus(
    raw: StatusResponse,
    deps: SustainDeps,
): Promise<StatusResponse> {
    if (deps.config.badMinutes <= 1) return raw;
    const now = deps.now ?? (() => new Date());
    const minute = Math.floor(now().getTime() / 60_000);
    let minutes: MinuteVerdict[];
    try {
        minutes = await deps.history.recordAndRead(
            raw.part,
            minute,
            { state: raw.state, reason: raw.reason },
            deps.config.windowMinutes,
        );
    } catch {
        return raw;
    }
    const verdict = sustainedVerdict(
        { state: raw.state, reason: raw.reason },
        minutes,
        deps.config,
    );
    return { ...raw, state: verdict.state, reason: verdict.reason };
}
