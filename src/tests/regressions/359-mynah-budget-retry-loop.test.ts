/**
 * Regression for #359. A hosted user whose included Mynah budget was used up
 * had every auto-transcribe retry slot claimed on every sync tick, each one
 * failing with MYNAH_BUDGET_EXHAUSTED. Sync must drop recordings that cannot
 * fit the remaining budget before claiming them, stop a pass once the budget
 * runs out, and pick transcription up again once the budget is back.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: true,
        BILLING_ENABLED: true,
        MYNAH_BASE_URL: "https://mynah.test",
        MYNAH_SERVICE_TOKEN: "service-token",
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        WHISPER_REQUEST_TIMEOUT_MS: 60 * 60 * 1000,
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/db/queries/billing", () => ({
    getUserBillingState: vi.fn(),
}));

vi.mock("@/lib/hosted/billing/cycle-close", () => ({
    closeCycleForUser: vi.fn(),
}));

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
    getEntitlements: vi.fn(),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn(),
}));

vi.mock("@/lib/sync/untranscribed", () => ({
    AUTO_TRANSCRIBE_RETRY_LIMIT: 5,
    listUntranscribedRecordingIds: vi.fn(),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));

import { db } from "@/db";
import { getUserBillingState } from "@/db/queries/billing";
import {
    apiCredentials,
    plaudConnections,
    recordings,
    userSettings,
    users,
} from "@/db/schema";
import { env } from "@/lib/env";
import { closeCycleForUser } from "@/lib/hosted/billing/cycle-close";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { resetAutoTranscribeStateForTests } from "@/lib/sync/auto-transcribe-state";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import {
    type AutoTranscribeRetryOptions,
    listUntranscribedRecordingIds,
} from "@/lib/sync/untranscribed";
import { RIFFADO_INCLUDED_PROVIDER_ID } from "@/lib/transcription/included-provider";
import {
    type TranscribeResult,
    transcribeRecording,
} from "@/lib/transcription/transcribe-recording";

const USER_ID = "user-359";
const SHORT_MS = 60 * 1000;
const LONG_MS = 3600 * 1000;

const mutableEnv = env as { IS_HOSTED: boolean; BILLING_ENABLED: boolean };
const HOUR_MS = 60 * 60 * 1000;

let untranscribed: string[] = [];
let durationsMs: Record<string, number> = {};
let remainingSeconds = 0;
let billingPlan: "hosted_pro" | null = "hosted_pro";
let grantResetAt: Date | null = null;
let settingsRow: Record<string, unknown> = {};
let legacyDefaultCredentials: { id: string }[] = [];

function fakeUntranscribedLookup(
    _userId: string,
    options: AutoTranscribeRetryOptions = {},
): Promise<string[]> {
    const exclude = new Set(options.excludeIds ?? []);
    const only = options.onlyIds ? new Set(options.onlyIds) : undefined;
    return Promise.resolve(
        untranscribed
            .filter((id) => !exclude.has(id) && (!only || only.has(id)))
            .slice(0, options.limit ?? 5),
    );
}

function rowsFor(table: unknown): unknown[] {
    if (table === plaudConnections) {
        return [{ id: "conn-1", userId: USER_ID, bearerToken: "enc" }];
    }
    if (table === userSettings) return [settingsRow];
    if (table === users) return [{ email: "u@example.com" }];
    if (table === apiCredentials) return legacyDefaultCredentials;
    if (table === recordings) {
        return Object.entries(durationsMs).map(([id, duration]) => ({
            id,
            duration,
        }));
    }
    return [];
}

function queryFor(rows: unknown[]) {
    return {
        where: vi.fn(() =>
            Object.assign(Promise.resolve(rows), {
                limit: vi.fn(() => Promise.resolve(rows)),
            }),
        ),
    };
}

async function runSync(): Promise<void> {
    const callsBefore = (transcribeRecording as Mock).mock.calls.length;
    await syncRecordingsForUser(USER_ID);
    await vi.waitFor(async () => {
        const settled = (transcribeRecording as Mock).mock.results
            .slice(callsBefore)
            .every((result) => result.type === "return");
        expect(settled).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function transcribedIds(): string[] {
    return (transcribeRecording as Mock).mock.calls.map(([, id]) => id);
}

const budgetExhausted: TranscribeResult = {
    success: false,
    error: "budget",
    errorCode: "MYNAH_BUDGET_EXHAUSTED",
};

describe("#359 auto-transcribe respects the Mynah budget", () => {
    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
        mutableEnv.IS_HOSTED = true;
        mutableEnv.BILLING_ENABLED = true;
        untranscribed = [];
        durationsMs = {};
        remainingSeconds = 0;
        billingPlan = "hosted_pro";
        grantResetAt = null;
        settingsRow = {
            autoTranscribe: true,
            defaultTranscriptionProviderId: RIFFADO_INCLUDED_PROVIDER_ID,
        };
        legacyDefaultCredentials = [];
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        (createPlaudClient as Mock).mockResolvedValue({
            getRecordings: vi.fn().mockResolvedValue({ data_file_list: [] }),
        });
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        (db.select as Mock).mockImplementation(() => ({
            from: (table: unknown) => queryFor(rowsFor(table)),
        }));
        (listUntranscribedRecordingIds as Mock).mockImplementation(
            fakeUntranscribedLookup,
        );
        (getUserBillingState as Mock).mockImplementation(async () => ({
            plan: billingPlan,
            monthlyMynahGrantResetAt: grantResetAt,
            monthlyMynahSecondsRemaining: remainingSeconds,
        }));
        (closeCycleForUser as Mock).mockResolvedValue(false);
        (transcribeRecording as Mock).mockResolvedValue({
            success: true,
            text: "ok",
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("makes no transcribe calls while the budget is used up", async () => {
        untranscribed = ["rec-a", "rec-b"];
        durationsMs = { "rec-a": SHORT_MS, "rec-b": SHORT_MS };
        remainingSeconds = 0;

        await runSync();
        await runSync();
        await runSync();

        expect(transcribeRecording).not.toHaveBeenCalled();
    });

    it("transcribes again once the counter is refilled", async () => {
        untranscribed = ["rec-a", "rec-b"];
        durationsMs = { "rec-a": SHORT_MS, "rec-b": SHORT_MS };

        await runSync();
        expect(transcribeRecording).not.toHaveBeenCalled();

        remainingSeconds = 3600;
        await runSync();

        expect(transcribedIds().sort()).toEqual(["rec-a", "rec-b"]);
    });

    it("applies a due cycle reset before reading the remaining seconds", async () => {
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        remainingSeconds = 0;
        (closeCycleForUser as Mock).mockImplementation(async () => {
            remainingSeconds = 7200;
            return true;
        });

        await runSync();

        expect(closeCycleForUser).toHaveBeenCalledWith(USER_ID);
        expect(getUserBillingState).toHaveBeenCalledTimes(2);
        expect(transcribedIds()).toEqual(["rec-a"]);
    });

    it("applies a reset whose due time has passed", async () => {
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        grantResetAt = new Date(Date.now() - HOUR_MS);
        (closeCycleForUser as Mock).mockImplementation(async () => {
            remainingSeconds = 7200;
            return true;
        });

        await runSync();

        expect(closeCycleForUser).toHaveBeenCalledWith(USER_ID);
        expect(transcribedIds()).toEqual(["rec-a"]);
    });

    it("does not close a cycle for a user without a plan", async () => {
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        billingPlan = null;
        grantResetAt = null;

        await runSync();

        expect(closeCycleForUser).not.toHaveBeenCalled();
        expect(transcribeRecording).not.toHaveBeenCalled();
    });

    it("does not close a cycle when billing is disabled", async () => {
        mutableEnv.BILLING_ENABLED = false;
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        grantResetAt = null;

        await runSync();

        expect(closeCycleForUser).not.toHaveBeenCalled();
        expect(transcribeRecording).not.toHaveBeenCalled();
    });

    it("does not close a cycle whose reset is not due yet", async () => {
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        grantResetAt = new Date(Date.now() + HOUR_MS);

        await runSync();

        expect(closeCycleForUser).not.toHaveBeenCalled();
        expect(transcribeRecording).not.toHaveBeenCalled();
    });

    it("only transcribes the recordings that fit the remaining budget", async () => {
        untranscribed = ["rec-long", "rec-short"];
        durationsMs = { "rec-long": LONG_MS, "rec-short": SHORT_MS };
        remainingSeconds = 120;

        await runSync();

        expect(transcribedIds()).toEqual(["rec-short"]);
    });

    it("rounds the duration up to whole seconds like the reservation", async () => {
        untranscribed = ["rec-a", "rec-b"];
        durationsMs = { "rec-a": 60_001, "rec-b": 60_000 };
        remainingSeconds = 60;

        await runSync();

        expect(transcribedIds()).toEqual(["rec-b"]);
    });

    it("ignores the budget when the default is the user's own credential", async () => {
        settingsRow = {
            autoTranscribe: true,
            defaultTranscriptionProviderId: "cred-own",
        };
        untranscribed = ["rec-a", "rec-b"];
        durationsMs = { "rec-a": LONG_MS, "rec-b": LONG_MS };
        remainingSeconds = 0;

        await runSync();

        expect(transcribedIds().sort()).toEqual(["rec-a", "rec-b"]);
        expect(getUserBillingState).not.toHaveBeenCalled();
        expect(closeCycleForUser).not.toHaveBeenCalled();
    });

    it("ignores the budget when no pointer is set and a legacy default credential exists", async () => {
        settingsRow = { autoTranscribe: true };
        legacyDefaultCredentials = [{ id: "cred-legacy" }];
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": LONG_MS };
        remainingSeconds = 0;

        await runSync();

        expect(transcribedIds()).toEqual(["rec-a"]);
        expect(getUserBillingState).not.toHaveBeenCalled();
    });

    it("applies the budget when no pointer is set and Mynah is the fallback", async () => {
        settingsRow = { autoTranscribe: true };
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        remainingSeconds = 0;

        await runSync();

        expect(transcribeRecording).not.toHaveBeenCalled();
        expect(getUserBillingState).toHaveBeenCalledWith(USER_ID);
    });

    it("leaves self-host untouched", async () => {
        mutableEnv.IS_HOSTED = false;
        settingsRow = { autoTranscribe: true };
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": LONG_MS };
        remainingSeconds = 0;

        await runSync();

        expect(transcribedIds()).toEqual(["rec-a"]);
        expect(getUserBillingState).not.toHaveBeenCalled();
        expect(closeCycleForUser).not.toHaveBeenCalled();
    });

    it("falls back to the old behaviour when the budget cannot be read", async () => {
        untranscribed = ["rec-a"];
        durationsMs = { "rec-a": SHORT_MS };
        (getUserBillingState as Mock).mockRejectedValue(new Error("db down"));

        await runSync();

        expect(transcribedIds()).toEqual(["rec-a"]);
    });

    it("skips longer ids after a mid-pass budget failure and releases them", async () => {
        untranscribed = ["rec-1", "rec-2", "rec-3"];
        durationsMs = {
            "rec-1": 600 * 1000,
            "rec-2": 900 * 1000,
            "rec-3": 120 * 1000,
        };
        remainingSeconds = 1000;
        (transcribeRecording as Mock).mockImplementation(
            async (_userId: string, id: string) =>
                id === "rec-1"
                    ? budgetExhausted
                    : { success: true, text: "ok" },
        );

        await runSync();

        expect(transcribedIds()).toEqual(["rec-1", "rec-3"]);

        (transcribeRecording as Mock).mockClear();
        (transcribeRecording as Mock).mockResolvedValue({
            success: true,
            text: "ok",
        });
        await runSync();

        expect(transcribedIds()).toContain("rec-2");
    });
});
