/**
 * Regression test for issue #283:
 *   "Summary job is not scoped to a recording; spinner and result follow
 *    the user to whichever recording is open"
 *
 * `useTranscriptionSummary` kept a single `isSummarizing` + `summaryData`.
 * Dashboard `TranscriptionPanel` stays mounted across selection, so a
 * Summarize on A leaked the spinner onto B and wrote A's result into B
 * when the POST settled. These helpers are what the hook uses to key
 * spinner and result by recording id.
 *
 * Covers: id change mid-flight, completion after switch, two recordings,
 * returning to A while A's job is still running.
 */

import { describe, expect, it } from "vitest";
import {
    addSummarizingId,
    isSummarizingForView,
    removeSummarizingId,
    shouldApplySummaryToView,
} from "@/lib/summary/job-scope";

type Summary = { summary: string };

function createView(initialId: string) {
    let viewId: string | null = initialId;
    let summarizingIds = new Set<string>();
    let summaryData: Summary | null = null;

    return {
        snapshot() {
            return {
                isSummarizing: isSummarizingForView(viewId, summarizingIds),
                summaryData,
            };
        },
        select(id: string) {
            viewId = id;
            summaryData = null;
        },
        start(id: string) {
            summarizingIds = addSummarizingId(summarizingIds, id);
        },
        complete(id: string, data: Summary) {
            if (shouldApplySummaryToView(viewId, id)) {
                summaryData = data;
            }
            summarizingIds = removeSummarizingId(summarizingIds, id);
        },
    };
}

describe("summary job scope (#283)", () => {
    it("does not show A's spinner on B after an id change mid-flight", () => {
        const view = createView("rec-a");
        view.start("rec-a");
        expect(view.snapshot().isSummarizing).toBe(true);

        view.select("rec-b");
        expect(view.snapshot()).toEqual({
            isSummarizing: false,
            summaryData: null,
        });
    });

    it("does not write A's completed result into B's UI", () => {
        const view = createView("rec-a");
        view.start("rec-a");
        view.select("rec-b");
        view.complete("rec-a", { summary: "summary for A" });

        expect(view.snapshot()).toEqual({
            isSummarizing: false,
            summaryData: null,
        });
    });

    it("keeps A's spinner when returning to A while the job is still running", () => {
        const view = createView("rec-a");
        view.start("rec-a");
        view.select("rec-b");
        expect(view.snapshot().isSummarizing).toBe(false);

        view.select("rec-a");
        expect(view.snapshot().isSummarizing).toBe(true);

        view.complete("rec-a", { summary: "summary for A" });
        expect(view.snapshot()).toEqual({
            isSummarizing: false,
            summaryData: { summary: "summary for A" },
        });
    });

    it("scopes two recordings independently", () => {
        const view = createView("rec-a");
        view.start("rec-a");
        view.select("rec-b");
        view.start("rec-b");

        expect(view.snapshot().isSummarizing).toBe(true);

        view.complete("rec-a", { summary: "summary for A" });
        expect(view.snapshot()).toEqual({
            isSummarizing: true,
            summaryData: null,
        });

        view.complete("rec-b", { summary: "summary for B" });
        expect(view.snapshot()).toEqual({
            isSummarizing: false,
            summaryData: { summary: "summary for B" },
        });

        view.select("rec-a");
        expect(view.snapshot()).toEqual({
            isSummarizing: false,
            summaryData: null,
        });
    });
});
