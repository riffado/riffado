import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/untranscribed", () => ({
    AUTO_TRANSCRIBE_RETRY_LIMIT: 5,
    listUntranscribedRecordingIds: vi.fn(async () => []),
}));

import {
    drainPending,
    resetStatusRecorderForTests,
    setStatusRecordingEnabled,
} from "@/lib/status/record";
import {
    claimAutoTranscribeIds,
    noteAutoTranscribeOutcome,
    recordAutoTranscribeStatus,
    resetAutoTranscribeStateForTests,
} from "@/lib/sync/auto-transcribe-state";

function autoTranscribeRun() {
    return (
        drainPending().jobs.find((job) => job.job === "auto-transcribe") ?? null
    );
}

describe("auto-transcribe status recording", () => {
    beforeEach(() => {
        resetStatusRecorderForTests();
        resetAutoTranscribeStateForTests();
        setStatusRecordingEnabled(true);
    });

    it("records nothing when there was nothing to claim or everything is already in flight", () => {
        expect(claimAutoTranscribeIds([])).toEqual([]);
        expect(claimAutoTranscribeIds(["a"])).toEqual(["a"]);
        expect(claimAutoTranscribeIds(["a"])).toEqual([]);
        expect(autoTranscribeRun()).toBeNull();
    });

    it("leaves status recording to recordAutoTranscribeStatus", () => {
        noteAutoTranscribeOutcome("user-1", "a", true);
        noteAutoTranscribeOutcome("user-1", "b", false);
        expect(autoTranscribeRun()).toBeNull();
    });

    it("records a success only when a transcript was produced", () => {
        recordAutoTranscribeStatus({ success: true });
        expect(autoTranscribeRun()).toMatchObject({
            lastSuccessAt: expect.any(Date),
            lastErrorAt: null,
        });
    });

    it("ignores failures the user caused", () => {
        for (const errorCode of [
            "HOSTED_LOCKED_OUT",
            "MYNAH_BUDGET_EXHAUSTED",
            "FILE_TOO_LARGE",
            "NO_TRANSCRIPTION_PROVIDER",
            "RECORDING_NOT_FOUND",
            "RECORDING_DELETED",
        ] as const) {
            recordAutoTranscribeStatus({ success: false, errorCode });
        }
        recordAutoTranscribeStatus({
            success: false,
            errorCode: "TRANSCRIPTION_FAILED",
            providerStatus: 401,
        });
        recordAutoTranscribeStatus({
            success: false,
            errorCode: "TRANSCRIPTION_FAILED",
            providerStatus: 403,
        });
        recordAutoTranscribeStatus({
            success: false,
            errorCode: "TRANSCRIPTION_FAILED",
            providerStatus: 403,
            managedProvider: false,
        });
        expect(autoTranscribeRun()).toBeNull();
    });

    it("records a refused Mynah service token (401/403 on the managed provider)", () => {
        for (const providerStatus of [401, 403]) {
            recordAutoTranscribeStatus({
                success: false,
                errorCode: "TRANSCRIPTION_FAILED",
                providerStatus,
                managedProvider: true,
            });
            expect(autoTranscribeRun()).toMatchObject({
                lastSuccessAt: null,
                lastErrorAt: expect.any(Date),
            });
        }
    });

    it("records provider and unexpected failures", () => {
        recordAutoTranscribeStatus({
            success: false,
            errorCode: "TRANSCRIPTION_FAILED",
            providerStatus: 503,
        });
        expect(autoTranscribeRun()).toMatchObject({
            lastSuccessAt: null,
            lastErrorAt: expect.any(Date),
        });
        recordAutoTranscribeStatus({
            success: false,
            errorCode: "TRANSCRIPTION_FAILED",
        });
        recordAutoTranscribeStatus(null);
        expect(autoTranscribeRun()).toMatchObject({
            lastErrorAt: expect.any(Date),
        });
    });
});
