/**
 * Regression for issue #241 auto-transcribe retry starvation.
 * A newest-first limit of 5 must rotate past persistent failures so
 * older transcriptless recordings still get an attempt. Process-local
 * only — no attempt-status schema.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/sync/untranscribed", () => ({
    listUntranscribedRecordingIds: vi.fn(),
}));

import {
    claimAutoTranscribeIds,
    listAutoTranscribeRetryIds,
    noteAutoTranscribeOutcome,
    releaseAutoTranscribeIds,
    resetAutoTranscribeStateForTests,
} from "@/lib/sync/auto-transcribe-state";
import { listUntranscribedRecordingIds } from "@/lib/sync/untranscribed";

const newestFive = ["n1", "n2", "n3", "n4", "n5"];
const olderTwo = ["o1", "o2"];

describe("issue #241: auto-transcribe retry rotation", () => {
    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
    });

    it("excludes recent failures from the next newest-first window", async () => {
        (listUntranscribedRecordingIds as Mock).mockResolvedValue(olderTwo);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome(id, false);
        }

        const ids = await listAutoTranscribeRetryIds("user-1", {
            transcriptMode: "plaud_only",
        });

        expect(ids).toEqual(olderTwo);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(1);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledWith("user-1", {
            transcriptMode: "plaud_only",
            excludeIds: newestFive,
        });
    });

    it("wraps around and retries failures after the rest of the backlog is empty", async () => {
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(newestFive);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome(id, false);
        }

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(newestFive);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(2);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            "user-1",
            { excludeIds: newestFive },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-1",
            { excludeIds: [] },
        );
    });

    it("does not wrap around when there were no recent failures", async () => {
        (listUntranscribedRecordingIds as Mock).mockResolvedValue([]);

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual([]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(1);
    });

    it("drops a recording from the failure window after a later success", async () => {
        (listUntranscribedRecordingIds as Mock).mockResolvedValue(["n2"]);
        noteAutoTranscribeOutcome("n1", false);
        noteAutoTranscribeOutcome("n1", true);

        await listAutoTranscribeRetryIds("user-1");

        expect(listUntranscribedRecordingIds).toHaveBeenCalledWith("user-1", {
            excludeIds: [],
        });
    });

    it("keeps in-flight ids excluded even after the failure window wraps", async () => {
        const claimed = claimAutoTranscribeIds(["busy"]);
        expect(claimed).toEqual(["busy"]);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome(id, false);
        }
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(["o1"]);

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(["o1"]);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-1",
            { excludeIds: ["busy"] },
        );
        releaseAutoTranscribeIds(claimed);
    });
});
