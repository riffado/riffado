import type { ProbeResult, StatusPart } from "./types";

/** A slow or down probe is retried sooner so recovery shows within a minute or two. */
export const FAILED_PROBE_TTL_S = 60;

/** A result older than its TTL is still served (while refreshing) up to this many TTLs. */
export const STALE_FACTOR = 3;

/** Longest a check waits for a probe with no cached result. */
export const PROBE_PENDING_AFTER_MS = 6000;

type Entry = { result: ProbeResult; expiresAt: number };

function ttlFor(result: ProbeResult, ttlS: number): number {
    return result.state === "ok" ? ttlS : Math.min(ttlS, FAILED_PROBE_TTL_S);
}

/**
 * Per-process probe cache. At most one probe per part runs at a time. A
 * fresh result is answered from memory; an expired one within the stale
 * window is answered at once and refreshed in the background. With no
 * usable result the caller waits at most `PROBE_PENDING_AFTER_MS`, then
 * gets down "probe-pending" while the probe runs on and fills the cache.
 */
export function createProbeCache(now: () => number = Date.now) {
    const memory = new Map<StatusPart, Entry>();
    const inFlight = new Map<StatusPart, Promise<ProbeResult>>();

    async function run(
        part: StatusPart,
        ttlS: number,
        fn: () => Promise<ProbeResult>,
    ): Promise<ProbeResult> {
        let result: ProbeResult;
        try {
            result = await fn();
        } catch (error) {
            console.warn(
                `[status] probe for ${part} threw:`,
                error instanceof Error ? error.message : error,
            );
            result = { state: "down", reason: "probe-failed", latencyMs: null };
        }
        memory.set(part, {
            result,
            expiresAt: now() + ttlFor(result, ttlS) * 1000,
        });
        return result;
    }

    function start(
        part: StatusPart,
        ttlS: number,
        fn: () => Promise<ProbeResult>,
    ): Promise<ProbeResult> {
        const running = inFlight.get(part);
        if (running) return running;
        const promise = run(part, ttlS, fn).finally(() => {
            inFlight.delete(part);
        });
        inFlight.set(part, promise);
        return promise;
    }

    function awaitCapped(work: Promise<ProbeResult>): Promise<ProbeResult> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const pending = new Promise<ProbeResult>((resolve) => {
            timer = setTimeout(
                () =>
                    resolve({
                        state: "down",
                        reason: "probe-pending",
                        latencyMs: null,
                    }),
                PROBE_PENDING_AFTER_MS,
            );
        });
        return Promise.race([work, pending]).finally(() => {
            clearTimeout(timer);
        });
    }

    return function cachedProbe(
        part: StatusPart,
        ttlS: number,
        fn: () => Promise<ProbeResult>,
    ): Promise<ProbeResult> {
        const cached = memory.get(part);
        if (cached && cached.expiresAt > now()) {
            return Promise.resolve(cached.result);
        }
        if (
            cached &&
            now() - cached.expiresAt < ttlS * 1000 * (STALE_FACTOR - 1)
        ) {
            void start(part, ttlS, fn);
            return Promise.resolve(cached.result);
        }
        return awaitCapped(start(part, ttlS, fn));
    };
}

let instance = createProbeCache();

/**
 * Cached probe result for `part`, running `fn` at most once per TTL in this
 * process. Never throws: a throwing probe is down "probe-failed". Non-ok
 * results are cached for at most a minute.
 */
export function cachedProbe(
    part: StatusPart,
    ttlS: number,
    fn: () => Promise<ProbeResult>,
): Promise<ProbeResult> {
    return instance(part, ttlS, fn);
}

/** Test-only: forget every cached probe. */
export function resetProbeCacheForTests(): void {
    instance = createProbeCache();
}
