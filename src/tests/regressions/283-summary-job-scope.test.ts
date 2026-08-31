/**
 * Regression test for issue #283:
 *   "Summary job is not scoped to a recording; spinner and result follow
 *    the user to whichever recording is open"
 *
 * Helper tests cover the id-keying predicates. Hook tests mount the real
 * `useTranscriptionSummary` with a mocked fetch so a wiring regression
 * (single boolean, missing apply guard, missing generation token,
 * ungated POST toasts, stale POST after re-transcribe) fails.
 *
 * Covers: id change mid-flight, completion after switch, two recordings,
 * returning to A while A's job is still running, delete restore after
 * switch, GET-after-POST, A → B → A stale GET, POST toasts after switch,
 * stale POST after transcription change, refetch, or off-screen
 * re-transcribe.
 */

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import {
    addSummarizingId,
    bumpContentGeneration,
    contentGenerationFor,
    isSummarizingForView,
    rememberTranscriptionText,
    removeSummarizingId,
    shouldApplyFetchedSummary,
    shouldApplySummaryToView,
} from "@/lib/summary/job-scope";

vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
    },
}));

type Summary = { summary: string };

type PendingRequest = {
    url: string;
    method: string;
    resolve: (value: Response) => void;
    reject: (reason?: unknown) => void;
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function summaryBody(text: string) {
    return { summary: text, keyPoints: null, actionItems: null };
}

let pending: PendingRequest[] = [];

beforeEach(() => {
    pending = [];
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/api/settings/user")) {
            return Promise.resolve(jsonResponse({}));
        }
        return new Promise<Response>((resolve, reject) => {
            pending.push({ url, method, resolve, reject });
        });
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function takePending(method: string, recordingId: string): PendingRequest {
    const needle = `/api/recordings/${recordingId}/summary`;
    const idx = pending.findIndex(
        (p) => p.method === method && p.url.includes(needle),
    );
    if (idx < 0) {
        throw new Error(
            `missing ${method} ${recordingId}: ${JSON.stringify(pending)}`,
        );
    }
    const [req] = pending.splice(idx, 1);
    return req;
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

function renderSummary(recordingId: string, transcriptionText: string) {
    return renderHook(
        (props: { recordingId: string; transcriptionText: string }) =>
            useTranscriptionSummary(props),
        { initialProps: { recordingId, transcriptionText } },
    );
}

function expectNoSummaryToasts() {
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
}

async function summarizeOnAThenSwitchToB() {
    const hook = renderSummary("rec-a", "text-a");
    await flush();
    takePending("GET", "rec-a").resolve(jsonResponse({}));
    await flush();

    let summarize!: Promise<void>;
    act(() => {
        summarize = hook.result.current.handleSummarize();
    });
    await flush();

    hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
    await flush();
    takePending("GET", "rec-b").resolve(jsonResponse({}));
    await flush();

    return { hook, summarize };
}

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
        restoreDelete(id: string, previous: Summary | null) {
            if (shouldApplySummaryToView(viewId, id)) {
                summaryData = previous;
            }
        },
    };
}

describe("summary job-scope helpers (#283)", () => {
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

    it("does not restore A's failed delete onto B", () => {
        const view = createView("rec-a");
        view.select("rec-b");
        view.restoreDelete("rec-a", { summary: "summary for A" });
        expect(view.snapshot().summaryData).toBeNull();
    });

    it("rejects a GET whose generation is no longer current", () => {
        expect(shouldApplyFetchedSummary("rec-a", "rec-a", 3, 1)).toBe(false);
        expect(shouldApplyFetchedSummary("rec-a", "rec-a", 3, 3)).toBe(true);
        expect(shouldApplyFetchedSummary("rec-b", "rec-a", 3, 3)).toBe(false);
    });

    it("rejects a POST after that recording's content generation moved", () => {
        const gens = new Map<string, number>();
        const postGen = contentGenerationFor(gens, "rec-a");
        bumpContentGeneration(gens, "rec-b");
        expect(
            shouldApplyFetchedSummary(
                "rec-a",
                "rec-a",
                contentGenerationFor(gens, "rec-a"),
                postGen,
            ),
        ).toBe(true);

        bumpContentGeneration(gens, "rec-a");
        expect(
            shouldApplyFetchedSummary(
                "rec-a",
                "rec-a",
                contentGenerationFor(gens, "rec-a"),
                postGen,
            ),
        ).toBe(false);
    });

    it("detects a recording's transcription change after visiting another id", () => {
        const texts = new Map<string, string | null | undefined>();
        expect(rememberTranscriptionText(texts, "rec-a", "text-a")).toBe(false);
        expect(rememberTranscriptionText(texts, "rec-b", "text-b")).toBe(false);
        expect(rememberTranscriptionText(texts, "rec-a", "text-a")).toBe(false);
        expect(rememberTranscriptionText(texts, "rec-a", "text-a-v2")).toBe(
            true,
        );
    });
});

describe("useTranscriptionSummary (#283)", () => {
    it("does not show A's spinner or summary on B after an id change mid-flight", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();
        expect(hook.result.current.isSummarizing).toBe(true);

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        expect(hook.result.current.isSummarizing).toBe(false);
        expect(hook.result.current.summaryData).toBeNull();

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from A")),
        );
        await act(async () => {
            await summarize;
        });
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        expect(hook.result.current.isSummarizing).toBe(false);
        expect(hook.result.current.summaryData).toBeNull();
    });

    it("does not write A's completed POST into B", async () => {
        const { hook, summarize } = await summarizeOnAThenSwitchToB();

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from A")),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData).toBeNull();
        expect(hook.result.current.isSummarizing).toBe(false);
        expectNoSummaryToasts();
    });

    it("does not toast A's POST HTTP error on B", async () => {
        const { hook, summarize } = await summarizeOnAThenSwitchToB();

        takePending("POST", "rec-a").resolve(
            jsonResponse({ error: "nope" }, 500),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData).toBeNull();
        expectNoSummaryToasts();
    });

    it("does not toast A's promptFallback warning on B", async () => {
        const { hook, summarize } = await summarizeOnAThenSwitchToB();

        takePending("POST", "rec-a").resolve(
            jsonResponse({ ...summaryBody("from A"), promptFallback: true }),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData).toBeNull();
        expectNoSummaryToasts();
    });

    it("does not toast A's POST network error on B", async () => {
        const { hook, summarize } = await summarizeOnAThenSwitchToB();

        takePending("POST", "rec-a").reject(new Error("network"));
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData).toBeNull();
        expectNoSummaryToasts();
    });

    it("keeps A's spinner when returning to A while the POST is still running", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        act(() => {
            void hook.result.current.handleSummarize();
        });
        await flush();

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();
        expect(hook.result.current.isSummarizing).toBe(false);

        hook.rerender({ recordingId: "rec-a", transcriptionText: "text-a" });
        await flush();
        expect(hook.result.current.isSummarizing).toBe(true);
    });

    it("scopes two in-flight recordings independently", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarizeA!: Promise<void>;
        act(() => {
            summarizeA = hook.result.current.handleSummarize();
        });
        await flush();

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        let summarizeB!: Promise<void>;
        act(() => {
            summarizeB = hook.result.current.handleSummarize();
        });
        await flush();
        expect(hook.result.current.isSummarizing).toBe(true);

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from A")),
        );
        await act(async () => {
            await summarizeA;
        });
        expect(hook.result.current.isSummarizing).toBe(true);
        expect(hook.result.current.summaryData).toBeNull();
        expectNoSummaryToasts();

        takePending("POST", "rec-b").resolve(
            jsonResponse(summaryBody("from B")),
        );
        await act(async () => {
            await summarizeB;
        });
        expect(hook.result.current.isSummarizing).toBe(false);
        expect(hook.result.current.summaryData?.summary).toBe("from B");
        expect(toast.success).toHaveBeenCalledWith("Summary generated");
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it("does not restore A's failed delete onto B", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(
            jsonResponse(summaryBody("from A")),
        );
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("from A");

        let deleted!: Promise<void>;
        act(() => {
            deleted = hook.result.current.handleDeleteSummary();
        });
        await flush();

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        takePending("DELETE", "rec-a").resolve(
            jsonResponse({ error: "fail" }, 500),
        );
        await act(async () => {
            await deleted;
        });

        expect(hook.result.current.summaryData).toBeNull();
        expect(hook.result.current.isSummarizing).toBe(false);
    });

    it("does not let a pre-existing GET overwrite a completed POST", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        const getA = takePending("GET", "rec-a");

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("generated")),
        );
        await act(async () => {
            await summarize;
        });
        expect(hook.result.current.summaryData?.summary).toBe("generated");
        expect(toast.success).toHaveBeenCalledWith("Summary generated");
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.warning).not.toHaveBeenCalled();

        getA.resolve(jsonResponse(summaryBody("stale GET")));
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("generated");
    });

    it("does not let an older A GET overwrite a newer A GET after A → B → A", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        const firstA = takePending("GET", "rec-a");

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        hook.rerender({ recordingId: "rec-a", transcriptionText: "text-a" });
        await flush();
        const secondA = takePending("GET", "rec-a");

        secondA.resolve(jsonResponse(summaryBody("newer A")));
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("newer A");

        firstA.resolve(jsonResponse(summaryBody("older A")));
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("newer A");
    });

    it("does not let a stale POST overwrite a GET after transcription changes", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();

        hook.rerender({
            recordingId: "rec-a",
            transcriptionText: "text-a-v2",
        });
        await flush();
        takePending("GET", "rec-a").resolve(
            jsonResponse(summaryBody("from re-transcribe")),
        );
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe(
            "from re-transcribe",
        );

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from old text")),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData?.summary).toBe(
            "from re-transcribe",
        );
        expectNoSummaryToasts();
    });

    it("does not let a stale POST overwrite a GET after refetchSummary", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();

        act(() => {
            hook.result.current.refetchSummary();
        });
        await flush();
        takePending("GET", "rec-a").resolve(
            jsonResponse(summaryBody("from refetch")),
        );
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("from refetch");

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from old text")),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData?.summary).toBe("from refetch");
        expectNoSummaryToasts();
    });

    it("applies A's POST after returning to A without a content change", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        hook.rerender({ recordingId: "rec-a", transcriptionText: "text-a" });
        await flush();
        expect(hook.result.current.isSummarizing).toBe(true);

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from A")),
        );
        await act(async () => {
            await summarize;
        });
        expect(hook.result.current.summaryData?.summary).toBe("from A");
        expect(toast.success).toHaveBeenCalledWith("Summary generated");

        takePending("GET", "rec-a").resolve(
            jsonResponse(summaryBody("stale GET after return")),
        );
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe("from A");
    });

    it("does not let A's POST overwrite a GET after off-screen re-transcribe", async () => {
        const hook = renderSummary("rec-a", "text-a");
        await flush();
        takePending("GET", "rec-a").resolve(jsonResponse({}));
        await flush();

        let summarize!: Promise<void>;
        act(() => {
            summarize = hook.result.current.handleSummarize();
        });
        await flush();

        hook.rerender({ recordingId: "rec-b", transcriptionText: "text-b" });
        await flush();
        takePending("GET", "rec-b").resolve(jsonResponse({}));
        await flush();

        hook.rerender({
            recordingId: "rec-a",
            transcriptionText: "text-a-v2",
        });
        await flush();
        takePending("GET", "rec-a").resolve(
            jsonResponse(summaryBody("from re-transcribe")),
        );
        await flush();
        expect(hook.result.current.summaryData?.summary).toBe(
            "from re-transcribe",
        );

        takePending("POST", "rec-a").resolve(
            jsonResponse(summaryBody("from old text")),
        );
        await act(async () => {
            await summarize;
        });

        expect(hook.result.current.summaryData?.summary).toBe(
            "from re-transcribe",
        );
        expectNoSummaryToasts();
    });
});
