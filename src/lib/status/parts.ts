import {
    getStatusJobRun,
    getStripeInboxHealth,
    pingDatabase,
} from "@/db/queries/status";
import { verifySmtpConnection } from "@/lib/email/transport";
import { env } from "@/lib/env";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";
import { isSmtpConfigured } from "@/lib/smtp";
import { createStorageProvider } from "@/lib/storage/factory";
import { decideStatus } from "./decide";
import { jobPolicy, judgeInbox, judgeJob } from "./jobs";
import { cachedProbe } from "./probe";
import {
    postgresVerdictHistory,
    type SustainConfig,
    sustainStatus,
} from "./sustain";
import {
    isStatusJob,
    type ProbeResult,
    type StatusJob,
    type StatusPart,
    type StatusResponse,
    type Thresholds,
    type TrafficPart,
} from "./types";
import { readWindow } from "./window";

/** Seconds a probe result is reused (per process). */
export const PROBE_TTL_S = 300;
/** Give up on a probe after this long ("probe-timeout", down). */
export const PROBE_TIMEOUT_MS = 8000;

const MINUTE_MS = 60_000;

/** Thresholds per traffic part. */
export const THRESHOLDS: Record<TrafficPart, Thresholds> = {
    "sign-in": {
        minRequests: 10,
        downErrorRate: 0.5,
        slowErrorRate: 0.1,
        slowP95Ms: 2000,
        downP95Ms: 10_000,
        ignoreSlowest: 1,
        minErrors: 2,
    },
    plaud: {
        minRequests: 5,
        downErrorRate: 0.5,
        slowErrorRate: 0.1,
        slowP95Ms: 5000,
        downP95Ms: 20_000,
        ignoreSlowest: 1,
        minErrors: 2,
    },
    transcription: {
        minRequests: 3,
        downErrorRate: 0.5,
        slowErrorRate: 0.2,
        slowP95Ms: 300_000,
        ignoreSlowest: 1,
        minErrors: 2,
    },
    storage: {
        minRequests: 5,
        downErrorRate: 0.5,
        slowErrorRate: 0.1,
        slowP95Ms: 10_000,
        ignoreSlowest: 1,
        minErrors: 2,
    },
    emails: {
        minRequests: 3,
        downErrorRate: 0.5,
        slowErrorRate: 0.2,
        slowP95Ms: 10_000,
        ignoreSlowest: 1,
        minErrors: 2,
    },
};

/** Sustained-verdict windows. External dependencies get the longer one. */
export const SUSTAIN: Record<TrafficPart, SustainConfig> = {
    "sign-in": { windowMinutes: 5, badMinutes: 3 },
    plaud: { windowMinutes: 7, badMinutes: 6 },
    transcription: { windowMinutes: 7, badMinutes: 6 },
    storage: { windowMinutes: 5, badMinutes: 3 },
    emails: { windowMinutes: 5, badMinutes: 3 },
};

const INBOX_FAILED_LOOKBACK_MS = 24 * 60 * MINUTE_MS;

function billingEnabled(): boolean {
    return env.IS_HOSTED && env.BILLING_ENABLED === true;
}

/** Whether `part` exists on this instance; unknown or not applicable parts 404. */
export function isPartApplicable(part: StatusPart): boolean {
    switch (part) {
        case "transcription":
            return isMynahConfigured();
        case "emails":
            return isSmtpConfigured();
        case "payments":
        case "billing-lapse":
            return billingEnabled();
        case "sync":
            return env.BACKGROUND_SYNC_ENABLED;
        default:
            return true;
    }
}

class ProbeTimeout extends Error {
    constructor(readonly ms: number) {
        super(`probe timed out after ${ms} ms`);
    }
}

async function timed<T>(
    fn: () => Promise<T>,
    timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ value: T; ms: number }> {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const value = await Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new ProbeTimeout(timeoutMs)),
                    timeoutMs,
                );
            }),
        ]);
        return { value, ms: Math.round(performance.now() - start) };
    } finally {
        clearTimeout(timer);
    }
}

function probeFailure(error: unknown): ProbeResult {
    return {
        state: "down",
        reason:
            error instanceof ProbeTimeout ? "probe-timeout" : "probe-failed",
        latencyMs: error instanceof ProbeTimeout ? error.ms : null,
    };
}

function byLatency(ms: number, slowMs: number): ProbeResult {
    return ms > slowMs
        ? { state: "slow", reason: "probe-slow", latencyMs: ms }
        : { state: "ok", reason: "probe-ok", latencyMs: ms };
}

/** Postgres `select 1`; slow above 1 s. */
export async function probeDatabase(): Promise<ProbeResult> {
    try {
        const { ms } = await timed(() => pingDatabase());
        return byLatency(ms, 1000);
    } catch (error) {
        return probeFailure(error);
    }
}

/** GET `${MYNAH_BASE_URL}/health`, expecting `{ ok: true }`; slow above 5 s. */
export async function probeMynah(): Promise<ProbeResult> {
    const base = env.MYNAH_BASE_URL;
    if (!base) {
        return { state: "down", reason: "not-configured", latencyMs: null };
    }
    try {
        const { value, ms } = await timed(async () => {
            const res = await fetch(`${base}/health`, {
                method: "GET",
                cache: "no-store",
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
            const body = (await res.json().catch(() => null)) as {
                ok?: unknown;
            } | null;
            return res.ok && body?.ok === true;
        });
        if (!value) {
            return { state: "down", reason: "probe-unhealthy", latencyMs: ms };
        }
        return byLatency(ms, 5000);
    } catch (error) {
        return probeFailure(error);
    }
}

/** The storage provider's own `testConnection()`; slow above 5 s. */
export async function probeStorage(): Promise<ProbeResult> {
    try {
        const { value, ms } = await timed(() =>
            createStorageProvider().testConnection(),
        );
        if (!value) {
            return { state: "down", reason: "probe-failed", latencyMs: ms };
        }
        return byLatency(ms, 5000);
    } catch (error) {
        return probeFailure(error);
    }
}

/** SMTP connect + auth without sending (`transporter.verify()`); slow above 5 s. */
export async function probeSmtp(): Promise<ProbeResult> {
    try {
        const { ms } = await timed(() => verifySmtpConnection());
        return byLatency(ms, 5000);
    } catch (error) {
        return probeFailure(error);
    }
}

async function noProbe(): Promise<ProbeResult> {
    return { state: "ok", reason: "no-traffic", latencyMs: null };
}

const PROBES: Record<TrafficPart, () => Promise<ProbeResult>> = {
    "sign-in": probeDatabase,
    plaud: noProbe,
    transcription: probeMynah,
    storage: probeStorage,
    emails: probeSmtp,
};

function elapsedSince(start: number): number {
    return Math.round(performance.now() - start);
}

async function trafficStatus(
    part: TrafficPart,
    start: number,
): Promise<StatusResponse> {
    const raw = await decideStatus(part, {
        readWindow: (p) => readWindow(p),
        thresholds: THRESHOLDS[part],
        probe: () => cachedProbe(part, PROBE_TTL_S, PROBES[part]),
        fallbackLatencyMs: () => elapsedSince(start),
    });
    return sustainStatus(raw, {
        history: postgresVerdictHistory,
        config: SUSTAIN[part],
    });
}

async function jobStatus(
    job: StatusJob,
    start: number,
): Promise<StatusResponse> {
    const now = new Date();
    const policy = jobPolicy(job);
    const base = {
        part: job,
        source: "job" as const,
        checkedAt: now.toISOString(),
    };
    try {
        const row = await getStatusJobRun(job);
        const verdict = judgeJob(row, policy, now);
        return {
            ...base,
            ...verdict,
            latencyMs: elapsedSince(start),
            job: {
                lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
                lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
                failingSince: row?.failingSince?.toISOString() ?? null,
                slowAfterMs: policy.slowAfterMs,
                downAfterMs: policy.downAfterMs,
            },
        };
    } catch {
        return {
            ...base,
            state: "down",
            reason: "metrics-unavailable",
            latencyMs: elapsedSince(start),
        };
    }
}

async function paymentsStatus(start: number): Promise<StatusResponse> {
    const now = new Date();
    const base = {
        part: "payments" as const,
        source: "inbox" as const,
        checkedAt: now.toISOString(),
    };
    try {
        const health = await getStripeInboxHealth(
            new Date(now.getTime() - INBOX_FAILED_LOOKBACK_MS),
        );
        return {
            ...base,
            ...judgeInbox(health, now),
            latencyMs: elapsedSince(start),
            inbox: {
                open: health.open,
                oldestOpenAgeMs: health.oldestOpenAt
                    ? Math.max(0, now.getTime() - health.oldestOpenAt.getTime())
                    : null,
                failedLast24h: health.failedSince,
            },
        };
    } catch {
        return {
            ...base,
            state: "down",
            reason: "metrics-unavailable",
            latencyMs: elapsedSince(start),
        };
    }
}

/**
 * Current status of one part, or null when the part does not apply to this
 * instance (the route answers 404).
 */
export async function getPartStatus(
    part: StatusPart,
): Promise<StatusResponse | null> {
    if (!isPartApplicable(part)) return null;
    const start = performance.now();
    if (part === "payments") return paymentsStatus(start);
    if (isStatusJob(part)) return jobStatus(part, start);
    return trafficStatus(part, start);
}
