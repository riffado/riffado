/**
 * Regression for the #282 auto-transcribe catch-up retry.
 * A provider rejection that can never succeed (413 over the duration
 * limit, 422 undecodable audio) was re-attempted on every sync, each
 * time re-downloading and re-uploading the full audio. Permanent
 * failures must stop auto retries, transient ones must back off and
 * stop at a cap, and a manual Re-transcribe must still run and clear
 * the stop.
 */

import { APIConnectionTimeoutError, APIError } from "openai";
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

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn(),
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

import { POST } from "@/app/api/recordings/[id]/transcribe/route";
import { db } from "@/db";
import { requireApiSession } from "@/lib/auth-server";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import {
    AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES,
    AUTO_TRANSCRIBE_RETRY_BACKOFF_MS,
    resetAutoTranscribeStateForTests,
} from "@/lib/sync/auto-transcribe-state";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import {
    type AutoTranscribeRetryOptions,
    listUntranscribedRecordingIds,
} from "@/lib/sync/untranscribed";
import { ElevenLabsFileTooLargeError } from "@/lib/transcription/elevenlabs-transcribe";
import { classifyTranscribeError } from "@/lib/transcription/failure-kind";
import {
    type TranscribeResult,
    transcribeRecording,
} from "@/lib/transcription/transcribe-recording";

const USER_ID = "user-282";

let untranscribed: string[] = [];

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

function selectReturning(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
            }),
        }),
    };
}

async function runSync(): Promise<void> {
    const callsBefore = (transcribeRecording as Mock).mock.calls.length;
    (db.select as Mock)
        .mockReturnValueOnce(
            selectReturning([
                { id: "conn-1", userId: USER_ID, bearerToken: "enc" },
            ]),
        )
        .mockReturnValueOnce(selectReturning([{ autoTranscribe: true }]))
        .mockReturnValueOnce(selectReturning([{ email: "u@example.com" }]));
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

function autoCallsFor(recordingId: string): number {
    return (transcribeRecording as Mock).mock.calls.filter(
        ([, id, opts]) => id === recordingId && opts?.trigger === "sync",
    ).length;
}

function providerFailure(status: number | undefined): TranscribeResult {
    const failure = classifyTranscribeError(
        status === undefined
            ? new APIConnectionTimeoutError()
            : APIError.generate(
                  status,
                  undefined,
                  `${status} status code (no body)`,
                  new Headers(),
              ),
    );
    return {
        success: false,
        error: `${status ?? "timeout"} status code (no body)`,
        errorCode: "TRANSCRIPTION_FAILED",
        failureKind: failure.kind,
        providerStatus: failure.status,
    };
}

describe("classifyTranscribeError", () => {
    it.each([400, 413, 415, 422])("treats HTTP %i as permanent", (status) => {
        expect(
            classifyTranscribeError(
                APIError.generate(status, undefined, "x", new Headers()),
            ),
        ).toEqual({ kind: "permanent", status });
    });

    it.each([
        408, 429, 500, 502, 503, 504,
    ])("treats HTTP %i as transient", (status) => {
        expect(
            classifyTranscribeError(
                APIError.generate(status, undefined, "x", new Headers()),
            ),
        ).toEqual({ kind: "transient", status });
    });

    it("treats timeouts and unknown errors as transient", () => {
        expect(
            classifyTranscribeError(new APIConnectionTimeoutError()).kind,
        ).toBe("transient");
        expect(classifyTranscribeError(new Error("socket hang up")).kind).toBe(
            "transient",
        );
    });

    it.each([
        401, 403,
    ])("leaves HTTP %i unclassified so settings fixes resume retries", (status) => {
        expect(
            classifyTranscribeError(
                APIError.generate(status, undefined, "x", new Headers()),
            ),
        ).toEqual({ status });
    });

    it("classifies a Mynah status-carrying error", () => {
        expect(
            classifyTranscribeError(
                Object.assign(new Error("Mynah transcription failed (422)"), {
                    status: 422,
                }),
            ),
        ).toEqual({ kind: "permanent", status: 422 });
    });

    it("treats the ElevenLabs local size check as permanent", () => {
        expect(
            classifyTranscribeError(new ElevenLabsFileTooLargeError(1)).kind,
        ).toBe("permanent");
    });
});

describe("#282 auto-transcribe stops on permanent provider failures", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        (createPlaudClient as Mock).mockResolvedValue({
            getRecordings: vi.fn().mockResolvedValue({ data_file_list: [] }),
        });
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });
        (listUntranscribedRecordingIds as Mock).mockImplementation(
            fakeUntranscribedLookup,
        );
        (requireApiSession as Mock).mockResolvedValue({
            user: { id: USER_ID },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        413, 422,
    ])("does not retry a %i on the next sync", async (status) => {
        untranscribed = ["rec-bad"];
        (transcribeRecording as Mock).mockResolvedValue(
            providerFailure(status),
        );

        await runSync();
        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
        await runSync();
        await runSync();

        expect(autoCallsFor("rec-bad")).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("rec-bad");
        expect(warn.mock.calls[0]?.[0]).toContain(`status ${status}`);
    });

    it.each([
        503,
        undefined,
    ])("backs off a transient failure (%s) and stops at the cap", async (status) => {
        untranscribed = ["rec-flaky"];
        (transcribeRecording as Mock).mockResolvedValue(
            providerFailure(status),
        );

        await runSync();
        expect(autoCallsFor("rec-flaky")).toBe(1);

        await runSync();
        expect(autoCallsFor("rec-flaky")).toBe(1);

        for (let i = 0; i < AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES + 3; i++) {
            vi.advanceTimersByTime(AUTO_TRANSCRIBE_RETRY_BACKOFF_MS * 2 ** i);
            await runSync();
        }

        expect(autoCallsFor("rec-flaky")).toBe(
            AUTO_TRANSCRIBE_MAX_TRANSIENT_FAILURES,
        );
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("still auto-transcribes newer recordings after one is stopped", async () => {
        untranscribed = ["rec-bad"];
        (transcribeRecording as Mock).mockImplementation(
            async (_userId: string, id: string) =>
                id === "rec-bad"
                    ? providerFailure(413)
                    : { success: true, text: "ok" },
        );

        await runSync();
        untranscribed = ["rec-new", "rec-bad"];
        await runSync();

        expect(autoCallsFor("rec-new")).toBe(1);
        expect(autoCallsFor("rec-bad")).toBe(1);
    });

    it("runs a manual Re-transcribe for a stopped recording and clears the stop", async () => {
        untranscribed = ["rec-bad"];
        (transcribeRecording as Mock).mockResolvedValueOnce(
            providerFailure(413),
        );
        await runSync();

        (transcribeRecording as Mock).mockResolvedValueOnce({
            success: true,
            text: "fixed",
            detectedLanguage: "en",
        });
        const response = await POST(
            new Request("http://localhost/api/recordings/rec-bad/transcribe", {
                method: "POST",
                body: "{}",
            }),
            { params: Promise.resolve({ id: "rec-bad" }) },
        );

        expect(response.status).toBe(200);
        expect(transcribeRecording).toHaveBeenLastCalledWith(
            USER_ID,
            "rec-bad",
            expect.objectContaining({ force: true, trigger: "manual" }),
        );

        untranscribed = [];
        (listUntranscribedRecordingIds as Mock).mockClear();
        await runSync();
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            USER_ID,
            expect.objectContaining({ excludeIds: [] }),
        );
    });
});
