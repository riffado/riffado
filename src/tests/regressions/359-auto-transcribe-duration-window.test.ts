/**
 * Regression for #359 starvation. The duration cap must reach the newest
 * window and the failure rotation, while the failure revalidation stays
 * uncapped so a too-long failure keeps its state instead of being forgotten.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/sync/untranscribed", () => ({
    AUTO_TRANSCRIBE_RETRY_LIMIT: 5,
    listUntranscribedRecordingIds: vi.fn(),
}));

import {
    listAutoTranscribeRetryIds,
    noteAutoTranscribeOutcome,
    resetAutoTranscribeStateForTests,
} from "@/lib/sync/auto-transcribe-state";
import { listUntranscribedRecordingIds } from "@/lib/sync/untranscribed";

const MAX_MS = 120_000;

describe("#359: auto-transcribe retry window with a duration cap", () => {
    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
    });

    it("passes the cap to the newest window only and to a separate fit check", async () => {
        noteAutoTranscribeOutcome("user-1", "f1", false);
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce(["new1"])
            .mockResolvedValueOnce(["f1"])
            .mockResolvedValueOnce(["f1"]);

        const ids = await listAutoTranscribeRetryIds("user-1", {
            maxDurationMs: MAX_MS,
        });

        expect(ids).toEqual(["new1", "f1"]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(3);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            "user-1",
            { maxDurationMs: MAX_MS, excludeIds: ["f1"] },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-1",
            { excludeIds: [], onlyIds: ["f1"], limit: 1 },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            3,
            "user-1",
            {
                excludeIds: [],
                onlyIds: ["f1"],
                maxDurationMs: MAX_MS,
                limit: 1,
            },
        );
    });

    it("does not let a too-long failure take the reserved slot", async () => {
        for (const id of ["long-failed", "short-failed"]) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce(["n1", "n2", "n3", "n4", "n5"])
            .mockResolvedValueOnce(["long-failed", "short-failed"])
            .mockResolvedValueOnce(["short-failed"]);

        const ids = await listAutoTranscribeRetryIds("user-1", {
            maxDurationMs: MAX_MS,
        });

        expect(ids).toEqual(["n1", "n2", "n3", "n4", "short-failed"]);
    });

    it("keeps a too-long failure in the failure window for later", async () => {
        noteAutoTranscribeOutcome("user-1", "long-failed", false);
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(["long-failed"])
            .mockResolvedValueOnce([]);

        const capped = await listAutoTranscribeRetryIds("user-1", {
            maxDurationMs: MAX_MS,
        });
        expect(capped).toEqual([]);

        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(["long-failed"]);

        const uncapped = await listAutoTranscribeRetryIds("user-1");
        expect(uncapped).toEqual(["long-failed"]);
    });

    it("falls back to the fresh window when the fit check fails", async () => {
        noteAutoTranscribeOutcome("user-1", "f1", false);
        vi.spyOn(console, "error").mockImplementation(() => {});
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce(["new1"])
            .mockResolvedValueOnce(["f1"])
            .mockRejectedValueOnce(new Error("db down"));

        const ids = await listAutoTranscribeRetryIds("user-1", {
            maxDurationMs: MAX_MS,
        });

        expect(ids).toEqual(["new1"]);
    });
});
