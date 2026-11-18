import {
    classify,
    emptyCounts,
    type ProbeResult,
    SEVERITY,
    type StatusPart,
    type StatusResponse,
    statusResponse,
    type Thresholds,
    type Verdict,
    type WindowCounts,
} from "./types";

export interface DecideDeps {
    readWindow: (part: StatusPart) => Promise<WindowCounts>;
    probe: () => Promise<ProbeResult>;
    thresholds: Thresholds;
    now?: () => Date;
    /** Latency reported when neither traffic nor probe has one. */
    fallbackLatencyMs?: () => number;
}

/**
 * Verdict from errors in a window too quiet for `classify()`. Two or more
 * errors and no ok: down; two or more errors with some ok: slow; a single
 * error: null (no effect). Reason "recent-errors". Never ok.
 */
export function quietErrorVerdict(counts: WindowCounts): Verdict | null {
    if (counts.err < 2) return null;
    return counts.ok === 0
        ? { state: "down", reason: "recent-errors" }
        : { state: "slow", reason: "recent-errors" };
}

/**
 * Judge one traffic part. Metrics unreadable: down "metrics-unavailable".
 * Enough traffic: `classify()`. Too little: the worse of the probe and
 * `quietErrorVerdict` (quiet errors win ties). A throwing probe is down.
 * Never ok without enough traffic or a passing probe.
 */
export async function decideStatus(
    part: StatusPart,
    deps: DecideDeps,
): Promise<StatusResponse> {
    const now = deps.now ?? (() => new Date());
    const fallback = deps.fallbackLatencyMs ?? (() => 0);

    let counts: WindowCounts;
    try {
        counts = await deps.readWindow(part);
    } catch {
        return statusResponse({
            part,
            counts: emptyCounts(),
            verdict: { state: "down", reason: "metrics-unavailable" },
            source: "traffic",
            probeLatencyMs: null,
            fallbackLatencyMs: fallback(),
            now: now(),
        });
    }

    const traffic = classify(counts, deps.thresholds);
    if (traffic) {
        return statusResponse({
            part,
            counts,
            verdict: traffic,
            source: "traffic",
            probeLatencyMs: null,
            fallbackLatencyMs: fallback(),
            now: now(),
        });
    }

    let probe: ProbeResult;
    try {
        probe = await deps.probe();
    } catch {
        probe = { state: "down", reason: "probe-failed", latencyMs: null };
    }
    const quiet = quietErrorVerdict(counts);
    if (quiet && SEVERITY[quiet.state] >= SEVERITY[probe.state]) {
        return statusResponse({
            part,
            counts,
            verdict: quiet,
            source: "traffic",
            probeLatencyMs: null,
            fallbackLatencyMs: fallback(),
            now: now(),
        });
    }
    return statusResponse({
        part,
        counts,
        verdict: { state: probe.state, reason: probe.reason },
        source: "probe",
        probeLatencyMs: probe.latencyMs,
        fallbackLatencyMs: fallback(),
        now: now(),
    });
}
