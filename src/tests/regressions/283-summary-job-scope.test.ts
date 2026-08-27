/**
 * Regression test for issue #283:
 *   "Summary job is not scoped to a recording; spinner and result follow
 *    the user to whichever recording is open"
 *
 * `useTranscriptionSummary` kept a single `isSummarizing` + `summaryData`.
 * Dashboard `TranscriptionPanel` stays mounted across selection, so a
 * Summarize on A leaked the spinner onto B and wrote A's result into B
 * when the POST settled. These helpers are what the hook uses for every
 * write and every spinner read.
 *
 * Covers: id change mid-flight, completion after switch, two recordings,
 * returning to A while A's job is still running.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    getInFlightSummary,
    hasInFlightSummary,
    isSummarizingForView,
    nextSummariesById,
    resetInFlightSummaries,
    type SummaryJobResult,
    summaryForView,
    trackInFlightSummary,
} from "@/lib/summary/job-scope";

type Summary = { summary: string };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

afterEach(() => {
    resetInFlightSummaries();
});

describe("summary job scope (#283)", () => {
    it("does not show A's spinner on B after an id change mid-flight", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);

        expect(isSummarizingForView("rec-a")).toBe(true);
        expect(isSummarizingForView("rec-b")).toBe(false);
        expect(summaryForView(new Map<string, Summary | null>(), "rec-b")).toBe(
            null,
        );

        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        await jobA;
        expect(hasInFlightSummary("rec-a")).toBe(false);
        expect(isSummarizingForView("rec-b")).toBe(false);
    });

    it("does not write A's completed result into B's visible summary", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);
        let byId = new Map<string, Summary | null>();

        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        const result = await jobA;
        if (result.status === "ok") {
            byId = nextSummariesById(byId, "rec-a", result.data);
        }

        expect(summaryForView(byId, "rec-b")).toBeNull();
        expect(summaryForView(byId, "rec-a")).toEqual({
            summary: "summary for A",
        });
        expect(isSummarizingForView("rec-a")).toBe(false);
        expect(isSummarizingForView("rec-b")).toBe(false);
    });

    it("keeps A's spinner when returning to A while the job is still running", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);

        expect(isSummarizingForView("rec-b")).toBe(false);
        expect(isSummarizingForView("rec-a")).toBe(true);
        expect(getInFlightSummary("rec-a")).toBe(jobA);

        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        await jobA;
        expect(isSummarizingForView("rec-a")).toBe(false);
    });

    it("scopes two in-flight recordings independently", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const b = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);
        const jobB = trackInFlightSummary("rec-b", () => b.promise);
        let byId = new Map<string, Summary | null>();

        expect(isSummarizingForView("rec-a")).toBe(true);
        expect(isSummarizingForView("rec-b")).toBe(true);

        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        const resultA = await jobA;
        if (resultA.status === "ok") {
            byId = nextSummariesById(byId, "rec-a", resultA.data);
        }

        expect(isSummarizingForView("rec-a")).toBe(false);
        expect(isSummarizingForView("rec-b")).toBe(true);
        expect(summaryForView(byId, "rec-a")).toEqual({
            summary: "summary for A",
        });
        expect(summaryForView(byId, "rec-b")).toBeNull();

        b.resolve({ status: "ok", data: { summary: "summary for B" } });
        const resultB = await jobB;
        if (resultB.status === "ok") {
            byId = nextSummariesById(byId, "rec-b", resultB.data);
        }

        expect(isSummarizingForView("rec-b")).toBe(false);
        expect(summaryForView(byId, "rec-a")).toEqual({
            summary: "summary for A",
        });
        expect(summaryForView(byId, "rec-b")).toEqual({
            summary: "summary for B",
        });
    });

    it("lets a late GET for A update A's slot without touching B", () => {
        let byId = nextSummariesById(
            new Map<string, Summary | null>(),
            "rec-b",
            null,
        );
        byId = nextSummariesById(byId, "rec-a", { summary: "summary for A" });

        expect(summaryForView(byId, "rec-b")).toBeNull();
        expect(summaryForView(byId, "rec-a")).toEqual({
            summary: "summary for A",
        });
    });

    it("ignores a GET for a recording that still has an in-flight POST", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);
        let byId = new Map<string, Summary | null>();

        if (!hasInFlightSummary("rec-a")) {
            byId = nextSummariesById(byId, "rec-a", null);
        }
        expect(summaryForView(byId, "rec-a")).toBeNull();
        expect(isSummarizingForView("rec-a")).toBe(true);

        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        const result = await jobA;
        if (result.status === "ok") {
            byId = nextSummariesById(byId, "rec-a", result.data);
        }
        expect(summaryForView(byId, "rec-a")).toEqual({
            summary: "summary for A",
        });
    });

    it("does not abort A's job when another recording starts", async () => {
        const a = deferred<SummaryJobResult<Summary>>();
        const b = deferred<SummaryJobResult<Summary>>();
        const jobA = trackInFlightSummary("rec-a", () => a.promise);
        const jobB = trackInFlightSummary("rec-b", () => b.promise);

        expect(hasInFlightSummary("rec-a")).toBe(true);
        a.resolve({ status: "ok", data: { summary: "summary for A" } });
        await expect(jobA).resolves.toEqual({
            status: "ok",
            data: { summary: "summary for A" },
        });
        expect(hasInFlightSummary("rec-b")).toBe(true);

        b.resolve({ status: "error", message: "failed" });
        await jobB;
    });
});
