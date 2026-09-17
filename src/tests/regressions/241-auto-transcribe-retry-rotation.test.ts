/**
 * Regression for issue #241 auto-transcribe retry starvation.
 * A newest-first limit of 5 must rotate past persistent failures so
 * older transcriptless recordings still get an attempt. Process-local
 * only — no attempt-status schema.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/sync/untranscribed", () => ({
    AUTO_TRANSCRIBE_RETRY_LIMIT: 5,
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
const incomingFive = ["new1", "new2", "new3", "new4", "new5"];

function mockFreshThenEligible(fresh: string[], eligible: string[]) {
    (listUntranscribedRecordingIds as Mock)
        .mockResolvedValueOnce(fresh)
        .mockResolvedValueOnce(eligible);
}

describe("issue #241: auto-transcribe retry rotation", () => {
    beforeEach(() => {
        resetAutoTranscribeStateForTests();
        vi.clearAllMocks();
    });

    it("fills leftover slots from the oldest still-eligible failures", async () => {
        mockFreshThenEligible(olderTwo, newestFive);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }

        const ids = await listAutoTranscribeRetryIds("user-1", {
            transcriptMode: "plaud_only",
        });

        expect(ids).toEqual(["o1", "o2", "n1", "n2", "n3"]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(2);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            "user-1",
            {
                transcriptMode: "plaud_only",
                excludeIds: newestFive,
            },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-1",
            {
                transcriptMode: "plaud_only",
                excludeIds: [],
                onlyIds: newestFive,
                limit: 5,
            },
        );
    });

    it("retries oldest eligible failures when the newest-first window is empty", async () => {
        mockFreshThenEligible([], newestFive);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(newestFive);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(2);
    });

    it("reserves one slot for an older failure when newer recordings keep arriving", async () => {
        mockFreshThenEligible(incomingFive, newestFive);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(["new1", "new2", "new3", "new4", "n1"]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(2);
    });

    it("does not inject failures when there were none", async () => {
        (listUntranscribedRecordingIds as Mock).mockResolvedValue([]);

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual([]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(1);
    });

    it("drops a recording from the failure window after a later success", async () => {
        (listUntranscribedRecordingIds as Mock).mockResolvedValue(["n2"]);
        noteAutoTranscribeOutcome("user-1", "n1", false);
        noteAutoTranscribeOutcome("user-1", "n1", true);

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(["n2"]);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledTimes(1);
        expect(listUntranscribedRecordingIds).toHaveBeenCalledWith("user-1", {
            excludeIds: [],
        });
    });

    it("skips in-flight ids when filling from the failure window", async () => {
        const claimed = claimAutoTranscribeIds(["n1"]);
        expect(claimed).toEqual(["n1"]);
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        mockFreshThenEligible([], ["n2", "n3", "n4", "n5"]);

        const ids = await listAutoTranscribeRetryIds("user-1");

        expect(ids).toEqual(["n2", "n3", "n4", "n5"]);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            2,
            "user-1",
            {
                excludeIds: ["n1"],
                onlyIds: ["n2", "n3", "n4", "n5"],
                limit: 4,
            },
        );
        releaseAutoTranscribeIds(claimed);
    });

    it("does not consume another user's failures when filling slots", async () => {
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        noteAutoTranscribeOutcome("user-2", "b-fail", false);
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(["b-fail"])
            .mockResolvedValueOnce(olderTwo)
            .mockResolvedValueOnce(newestFive);

        const user2 = await listAutoTranscribeRetryIds("user-2");
        const user1 = await listAutoTranscribeRetryIds("user-1");

        expect(user2).toEqual(["b-fail"]);
        expect(user1).toEqual(["o1", "o2", "n1", "n2", "n3"]);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            1,
            "user-2",
            { excludeIds: ["b-fail"] },
        );
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            3,
            "user-1",
            { excludeIds: newestFive },
        );
    });

    it("discards failed ids that are no longer eligible", async () => {
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        mockFreshThenEligible(olderTwo, []);

        const first = await listAutoTranscribeRetryIds("user-1");
        expect(first).toEqual(olderTwo);

        (listUntranscribedRecordingIds as Mock).mockResolvedValue(["fresh"]);
        const second = await listAutoTranscribeRetryIds("user-1");

        expect(second).toEqual(["fresh"]);
        expect(listUntranscribedRecordingIds).toHaveBeenLastCalledWith(
            "user-1",
            { excludeIds: [] },
        );
    });

    it("caps remembered failures per user", async () => {
        for (let i = 0; i < AUTO_TRANSCRIBE_FAILED_ID_LIMIT + 1; i++) {
            noteAutoTranscribeOutcome("user-1", `id-${i}`, false);
        }
        const remaining = Array.from(
            { length: AUTO_TRANSCRIBE_FAILED_ID_LIMIT },
            (_, i) => `id-${i + 1}`,
        );
        mockFreshThenEligible(["kept"], remaining);

        await listAutoTranscribeRetryIds("user-1");

        const excludeIds = (listUntranscribedRecordingIds as Mock).mock
            .calls[0][1].excludeIds as string[];
        expect(excludeIds).toHaveLength(AUTO_TRANSCRIBE_FAILED_ID_LIMIT);
        expect(excludeIds).not.toContain("id-0");
        expect(excludeIds).toContain("id-1");
        expect(excludeIds).toContain(`id-${AUTO_TRANSCRIBE_FAILED_ID_LIMIT}`);
    });

    it("does not drop a newer failure set replaced during revalidation", async () => {
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, false);
        }
        let resolveEligible: (ids: string[]) => void = () => {};
        (listUntranscribedRecordingIds as Mock)
            .mockResolvedValueOnce(olderTwo)
            .mockImplementationOnce(
                () =>
                    new Promise<string[]>((resolve) => {
                        resolveEligible = resolve;
                    }),
            );

        const pending = listAutoTranscribeRetryIds("user-1");
        await Promise.resolve();
        for (const id of newestFive) {
            noteAutoTranscribeOutcome("user-1", id, true);
        }
        noteAutoTranscribeOutcome("user-1", "later", false);
        resolveEligible(newestFive);

        expect(await pending).toEqual(olderTwo);

        mockFreshThenEligible(["fresh"], ["later"]);
        const next = await listAutoTranscribeRetryIds("user-1");
        expect(next).toEqual(["fresh", "later"]);
        expect(listUntranscribedRecordingIds).toHaveBeenNthCalledWith(
            3,
            "user-1",
            { excludeIds: ["later"] },
        );
    });
});
