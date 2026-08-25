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
    AUTO_TRANSCRIBE_FAILED_ID_LIMIT,
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
            noteAutoTranscribeOutcome("user-1", id, false);
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
            noteAutoTranscribeOutcome("user-1", id, false);
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
        noteAutoTranscribeOutcome("user-1", "n1", false);
        noteAutoTranscribeOutcome("user-1", "n1", true);

        await listAutoTranscribeRetryIds("user-1");

        expect(listUntranscribedRecordingIds).toHaveBeenCalledWith("user-1", {
            excludeIds: [],
        });
    });

    it("keeps in-flight ids excluded even after the failure window wraps", async () => {
        const claimed = claimAutoTranscribeIds(["busy"]);
        expect(claimed).toEqual(["busy"]);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
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

    it("does not clear another user's failures on wrap-around", async () => {
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        noteAutoTranscribeOutcome("user-2", "b-fail", false);
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(["b1"])
            .mockResolvedValueOnce(olderTwo);

        await listAutoTranscribeRetryIds("user-2");
        await listAutoTranscribeRetryIds("user-1");

        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            "user-2",
            { excludeIds: ["b-fail"] },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-2",
            { excludeIds: [] },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenLastCalledWith(
            "user-1",
            { excludeIds: newestFive },
        );
    });

    it("caps remembered failures per user", async () => {
        for (let i = 0; i < AUTO_TRANSCRIBE_FAILED_ID_LIMIT + 1; i++) {
            noteAutoTranscribeOutcome("user-1", `id-${i}`, false);
        }
        (listUntranscribedRecordingIds as Mock).mockResolvedValue(["kept"]);

        await listAutoTranscribeRetryIds("user-1");

        const excludeIds = (listUntranscribedRecordingIds as Mock).mock
            .calls[0][1].excludeIds as string[];
        expect(excludeIds).toHaveLength(AUTO_TRANSCRIBE_FAILED_ID_LIMIT);
        expect(excludeIds).not.toContain("id-0");
        expect(excludeIds).toContain("id-1");
        expect(excludeIds).toContain(`id-${AUTO_TRANSCRIBE_FAILED_ID_LIMIT}`);
    });
});
