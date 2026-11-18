import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, queriesMock, transportMock, storageMock } = vi.hoisted(() => ({
    envMock: {
        STATUS_TOKEN: "t".repeat(64) as string | undefined,
        IS_HOSTED: false,
        BILLING_ENABLED: undefined as boolean | undefined,
        BACKGROUND_SYNC_ENABLED: true,
        BACKGROUND_SYNC_INTERVAL_MS: 5 * 60_000,
        MYNAH_BASE_URL: undefined as string | undefined,
        MYNAH_SERVICE_TOKEN: undefined as string | undefined,
        SMTP_HOST: undefined as string | undefined,
        SMTP_USER: undefined as string | undefined,
        SMTP_PASSWORD: undefined as string | undefined,
    },
    queriesMock: {
        getStatusJobRun: vi.fn(),
        getStripeInboxHealth: vi.fn(),
        listStatusBuckets: vi.fn(),
        setStatusMinuteVerdict: vi.fn(),
        pingDatabase: vi.fn(),
    },
    transportMock: { verifySmtpConnection: vi.fn() },
    storageMock: { testConnection: vi.fn() },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db/queries/status", () => queriesMock);
vi.mock("@/lib/email/transport", () => transportMock);
vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => storageMock,
}));
vi.mock("@/lib/hosted/billing/enforcement", () => ({
    commitMynahReservation: vi.fn(),
    releaseMynahReservation: vi.fn(),
    reserveMynah: vi.fn(),
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: vi.fn() }));

import { getPartStatus, isPartApplicable } from "@/lib/status/parts";
import { resetProbeCacheForTests } from "@/lib/status/probe";
import { STATUS_PARTS } from "@/lib/status/types";

const originalFetch = global.fetch;

function selfHostEnv() {
    envMock.IS_HOSTED = false;
    envMock.BILLING_ENABLED = undefined;
    envMock.BACKGROUND_SYNC_ENABLED = true;
    envMock.MYNAH_BASE_URL = undefined;
    envMock.MYNAH_SERVICE_TOKEN = undefined;
    envMock.SMTP_HOST = undefined;
    envMock.SMTP_USER = undefined;
    envMock.SMTP_PASSWORD = undefined;
}

describe("part applicability", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetProbeCacheForTests();
        selfHostEnv();
        queriesMock.listStatusBuckets.mockResolvedValue([]);
        queriesMock.setStatusMinuteVerdict.mockResolvedValue(undefined);
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("404s transcription, emails, payments and billing-lapse on a plain self-host", async () => {
        for (const part of [
            "transcription",
            "emails",
            "payments",
            "billing-lapse",
        ] as const) {
            expect(isPartApplicable(part)).toBe(false);
            expect(await getPartStatus(part)).toBeNull();
        }
        expect(queriesMock.getStatusJobRun).not.toHaveBeenCalled();
        expect(queriesMock.getStripeInboxHealth).not.toHaveBeenCalled();
    });

    it("keeps sign-in, plaud, storage, sync, webhooks and auto-transcribe on self-host", () => {
        const applicable = STATUS_PARTS.filter(isPartApplicable);
        expect(applicable).toEqual([
            "sign-in",
            "plaud",
            "storage",
            "sync",
            "webhooks",
            "auto-transcribe",
        ]);
    });

    it("404s sync when the background sync worker is disabled", async () => {
        envMock.BACKGROUND_SYNC_ENABLED = false;
        expect(await getPartStatus("sync")).toBeNull();
    });

    it("needs IS_HOSTED as well as BILLING_ENABLED for payments", () => {
        envMock.BILLING_ENABLED = true;
        expect(isPartApplicable("payments")).toBe(false);
        envMock.IS_HOSTED = true;
        expect(isPartApplicable("payments")).toBe(true);
        expect(isPartApplicable("billing-lapse")).toBe(true);
    });

    it("enables transcription only when Mynah is configured on hosted", () => {
        envMock.MYNAH_BASE_URL = "https://mynah.example.com";
        envMock.MYNAH_SERVICE_TOKEN = "svc";
        expect(isPartApplicable("transcription")).toBe(false);
        envMock.IS_HOSTED = true;
        expect(isPartApplicable("transcription")).toBe(true);
    });

    it("enables emails when SMTP is configured", () => {
        envMock.SMTP_HOST = "smtp.example.com";
        envMock.SMTP_USER = "u";
        envMock.SMTP_PASSWORD = "p";
        expect(isPartApplicable("emails")).toBe(true);
    });
});

describe("part answers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetProbeCacheForTests();
        selfHostEnv();
        queriesMock.listStatusBuckets.mockResolvedValue([]);
        queriesMock.setStatusMinuteVerdict.mockResolvedValue(undefined);
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("sign-in with no traffic answers from the database probe", async () => {
        queriesMock.pingDatabase.mockResolvedValue(undefined);
        const res = await getPartStatus("sign-in");
        expect(res).toMatchObject({
            part: "sign-in",
            state: "ok",
            reason: "probe-ok",
            source: "probe",
        });
        expect(typeof res?.latencyMs).toBe("number");
    });

    it("every part is down metrics-unavailable when Postgres can't be read", async () => {
        queriesMock.listStatusBuckets.mockRejectedValue(new Error("db down"));
        queriesMock.setStatusMinuteVerdict.mockRejectedValue(
            new Error("db down"),
        );
        queriesMock.getStatusJobRun.mockRejectedValue(new Error("db down"));
        for (const part of ["plaud", "storage", "webhooks"] as const) {
            const res = await getPartStatus(part);
            expect(res).toMatchObject({
                part,
                state: "down",
                reason: "metrics-unavailable",
            });
            expect(typeof res?.latencyMs).toBe("number");
        }
    });

    it("plaud without traffic is ok (there is no probe without a user token)", async () => {
        const res = await getPartStatus("plaud");
        expect(res).toMatchObject({ state: "ok", reason: "no-traffic" });
    });

    it("storage probes testConnection and stays ok until a failure is sustained", async () => {
        storageMock.testConnection.mockResolvedValue(false);
        const res = await getPartStatus("storage");
        expect(storageMock.testConnection).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({
            state: "ok",
            reason: "transient-probe-failed",
            source: "probe",
        });
    });

    it("transcription probes Mynah /health", async () => {
        envMock.IS_HOSTED = true;
        envMock.MYNAH_BASE_URL = "https://mynah.example.com";
        envMock.MYNAH_SERVICE_TOKEN = "svc";
        const fetchMock = vi.fn(
            async () => new Response('{"ok":true}', { status: 200 }),
        );
        global.fetch = fetchMock as unknown as typeof fetch;
        const res = await getPartStatus("transcription");
        expect(fetchMock).toHaveBeenCalledWith(
            "https://mynah.example.com/health",
            expect.objectContaining({ method: "GET" }),
        );
        expect(res).toMatchObject({ state: "ok", reason: "probe-ok" });
    });

    it("emails probes SMTP verify", async () => {
        envMock.SMTP_HOST = "smtp.example.com";
        envMock.SMTP_USER = "u";
        envMock.SMTP_PASSWORD = "p";
        transportMock.verifySmtpConnection.mockResolvedValue(undefined);
        const res = await getPartStatus("emails");
        expect(transportMock.verifySmtpConnection).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ state: "ok", reason: "probe-ok" });
    });

    it("a job part reports its freshness and timestamps", async () => {
        queriesMock.getStatusJobRun.mockResolvedValue({
            lastSuccessAt: new Date(Date.now() - 60 * 60_000),
            lastErrorAt: null,
            failingSince: null,
        });
        const res = await getPartStatus("webhooks");
        expect(res).toMatchObject({
            part: "webhooks",
            state: "down",
            reason: "job-stale",
            source: "job",
            job: { slowAfterMs: 5 * 60_000, downAfterMs: 15 * 60_000 },
        });
        expect(typeof res?.latencyMs).toBe("number");
    });

    it("payments reports the Stripe inbox backlog when billing is enabled", async () => {
        envMock.IS_HOSTED = true;
        envMock.BILLING_ENABLED = true;
        queriesMock.getStripeInboxHealth.mockResolvedValue({
            open: 2,
            oldestOpenAt: new Date(Date.now() - 20 * 60_000),
            failedSince: 0,
        });
        const res = await getPartStatus("payments");
        expect(res).toMatchObject({
            part: "payments",
            state: "slow",
            reason: "inbox-backlog",
            source: "inbox",
            inbox: { open: 2, failedLast24h: 0 },
        });
    });
});
