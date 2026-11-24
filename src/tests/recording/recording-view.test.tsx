/**
 * @vitest-environment jsdom
 *
 * Recording view (W2 redesign): Overview opens by default when a summary
 * exists and Transcript otherwise, the More menu keeps every recording
 * action, there is no Share entry point, and the night player renders
 * the dot waveform as its scrubber.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { parseTranscript } from "@/components/recording/recording-transcript";
import { RecordingView } from "@/components/recording/recording-view";
import type {
    RecordingTranscript,
    TranscriptionProviderState,
} from "@/components/recording/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Recording } from "@/types/recording";

const SUMMARY = {
    summary: "Strong quarter and a firm ship date.",
    keyPoints: ["Revenue up 18% quarter on quarter."],
    actionItems: ["Sign off on the export spec by Friday."],
    provider: "groq",
    model: "llama-3.1-70b-versatile",
};

const TRANSCRIPT: RecordingTranscript = {
    source: "riffado",
    text: "[00:00] Let's get the review going.\n[00:18] Revenue closed at four point one million.",
    language: "en",
    provider: "Groq",
    transcriptionType: "server",
};

function recording(overrides: Partial<Recording> = {}): Recording {
    return {
        id: "rec-1",
        filename: "Q4 board meeting",
        duration: 23 * 60_000 + 41_000,
        startTime: new Date().toISOString(),
        filesize: 1,
        deviceSn: "SN-1",
        hasTranscript: true,
        hasSummary: false,
        waveformPeaks: Array.from({ length: 64 }, (_, i) => (i % 7) / 7),
        ...overrides,
    };
}

function mockFetch(summary: typeof SUMMARY | null) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            const body = url.endsWith("/summary")
                ? (summary ?? { summary: null })
                : {};
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }),
    );
}

function renderView(
    rec: Recording,
    transcripts: RecordingTranscript[],
    options: { transcriptionProviderState?: TranscriptionProviderState } = {},
) {
    return render(
        <ConfirmDialogProvider>
            <TooltipProvider>
                <RecordingView
                    recording={rec}
                    deviceName="Note Pro"
                    transcripts={transcripts}
                    isTranscribing={false}
                    onTranscribe={() => {}}
                    onTranscribeComplete={() => {}}
                    onDelete={async () => {}}
                    back={{ label: "Library", onBack: () => {} }}
                    summaryProviderState="ready"
                    transcriptionProviderState={
                        options.transcriptionProviderState
                    }
                    player={{ scrubberStyle: "waveform" }}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>,
    );
}

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("RecordingView tabs", () => {
    it("opens Overview when the recording has a summary", async () => {
        mockFetch(SUMMARY);
        renderView(recording({ hasSummary: true }), [TRANSCRIPT]);

        expect(
            screen
                .getByRole("tab", { name: "Overview" })
                .getAttribute("aria-selected"),
        ).toBe("true");
        await waitFor(() =>
            expect(
                screen.getByText("Revenue up 18% quarter on quarter."),
            ).not.toBeNull(),
        );
        expect(screen.getByText("Key points")).not.toBeNull();
        expect(screen.getByText("Action items")).not.toBeNull();
    });

    it("opens Transcript when there is no summary", () => {
        mockFetch(null);
        renderView(recording({ hasSummary: false }), [TRANSCRIPT]);

        expect(
            screen
                .getByRole("tab", { name: "Transcript" })
                .getAttribute("aria-selected"),
        ).toBe("true");
        expect(
            screen.getByText("Revenue closed at four point one million."),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Play from 00:18" }),
        ).not.toBeNull();
        expect(screen.getByText("English · 12 words")).not.toBeNull();
    });

    it("offers both ways to transcribe when there is no transcript", () => {
        mockFetch(null);
        renderView(recording({ hasTranscript: false }), []);

        expect(screen.getByText("Not transcribed yet")).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Transcribe" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Transcribe in browser" }),
        ).not.toBeNull();
    });

    it("leads with browser transcription when no provider can transcribe", () => {
        mockFetch(null);
        renderView(recording({ hasTranscript: false }), [], {
            transcriptionProviderState: "missing",
        });

        expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();
        expect(
            screen
                .getByRole("button", { name: "Transcribe in browser" })
                .className.includes("bg-ink"),
        ).toBe(true);
        expect(
            screen
                .getByRole("link", { name: "Add a provider" })
                .getAttribute("href"),
        ).toBe("/settings#transcription");
    });

    it("offers the transcribe actions on Overview too", () => {
        mockFetch(null);
        renderView(recording({ hasTranscript: false }), []);
        const overview = screen.getByRole("tab", { name: "Overview" });
        fireEvent.mouseDown(overview);
        expect(
            screen.getByText("Transcribe this recording to get a summary"),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Transcribe" }),
        ).not.toBeNull();
    });
});

describe("RecordingView summary loading", () => {
    it("holds the summary's place while it loads", async () => {
        let resolve: (r: Response) => void = () => {};
        vi.stubGlobal(
            "fetch",
            vi.fn((input: RequestInfo | URL) =>
                String(input).endsWith("/summary")
                    ? new Promise<Response>((r) => {
                          resolve = r;
                      })
                    : Promise.resolve(new Response("{}", { status: 200 })),
            ),
        );
        renderView(recording({ hasSummary: true }), [TRANSCRIPT]);

        expect(screen.getByLabelText("Loading summary")).not.toBeNull();
        expect(screen.queryByText(/need an AI provider/)).toBeNull();

        resolve(
            new Response(JSON.stringify(SUMMARY), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        await waitFor(() =>
            expect(
                screen.getByText("Revenue up 18% quarter on quarter."),
            ).not.toBeNull(),
        );
        expect(screen.queryByLabelText("Loading summary")).toBeNull();
    });

    it("says when the summary couldn't load and retries", async () => {
        let summaryCalls = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            if (!String(input).endsWith("/summary")) {
                return new Response("{}", { status: 200 });
            }
            summaryCalls += 1;
            return summaryCalls === 1
                ? new Response("{}", { status: 500 })
                : new Response(JSON.stringify(SUMMARY), {
                      status: 200,
                      headers: { "content-type": "application/json" },
                  });
        });
        vi.stubGlobal("fetch", fetchMock);
        renderView(recording({ hasSummary: true }), [TRANSCRIPT]);

        await waitFor(() =>
            expect(
                screen.getByText("Couldn't load the summary"),
            ).not.toBeNull(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() =>
            expect(
                screen.getByText("Revenue up 18% quarter on quarter."),
            ).not.toBeNull(),
        );
    });
});

describe("RecordingView top bar", () => {
    it("says where the transcript came from", () => {
        mockFetch(null);
        renderView(recording(), [TRANSCRIPT]);
        expect(screen.getByText("Transcribed with Groq")).not.toBeNull();
    });

    it("keeps Rename, Re-transcribe and Delete in the More menu", async () => {
        mockFetch(null);
        renderView(recording(), [TRANSCRIPT]);

        fireEvent.keyDown(
            screen.getByRole("button", { name: "More actions" }),
            { key: "Enter" },
        );

        await waitFor(() =>
            expect(
                screen.getByRole("menuitem", { name: "Rename" }),
            ).not.toBeNull(),
        );
        expect(
            screen.getByRole("menuitem", { name: "Re-transcribe" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("menuitem", { name: "Transcribe in browser" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("menuitem", { name: "Delete recording" }),
        ).not.toBeNull();
    });

    it("has no Share button", () => {
        mockFetch(null);
        renderView(recording(), [TRANSCRIPT]);
        expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
        expect(screen.queryByText(/share/i)).toBeNull();
    });
});

describe("RecordingView player", () => {
    it("renders the dot waveform as the scrubber", () => {
        mockFetch(null);
        renderView(recording(), [TRANSCRIPT]);

        const player = screen.getByRole("region", { name: "Player" });
        expect(player).not.toBeNull();
        expect(screen.getByRole("button", { name: "Play" })).not.toBeNull();
        const scrubber = screen.getByRole("slider", { name: "Seek" });
        expect(scrubber.querySelectorAll("circle").length).toBeGreaterThan(0);
        expect(scrubber.getAttribute("aria-valuetext")).toBe("00:00 of 23:41");
    });

    it("plays from a transcript timestamp", () => {
        mockFetch(null);
        const play = vi
            .spyOn(HTMLMediaElement.prototype, "play")
            .mockImplementation(async () => {});
        renderView(recording(), [TRANSCRIPT]);

        fireEvent.click(
            screen.getByRole("button", { name: "Play from 00:18" }),
        );

        expect(play).toHaveBeenCalledTimes(1);
        const audio = document.querySelector("audio");
        expect(audio?.currentTime).toBe(18);
    });
});

describe("parseTranscript", () => {
    it("splits timestamped lines into blocks", () => {
        expect(parseTranscript("[00:00] Hello\n[01:02] World")).toEqual([
            { time: "00:00", speaker: null, text: "Hello" },
            { time: "01:02", speaker: null, text: "World" },
        ]);
    });

    it("keeps speaker turns and continuation lines together", () => {
        expect(
            parseTranscript("SPEAKER_00: hello\nmore words\nSpeaker 1: hi"),
        ).toEqual([
            { time: null, speaker: "SPEAKER_00", text: "hello more words" },
            { time: null, speaker: "Speaker 1", text: "hi" },
        ]);
    });

    it("groups timestamped speaker headers with the text below", () => {
        expect(parseTranscript("[00:05] Speaker 2\nWe shipped it.")).toEqual([
            { time: "00:05", speaker: "Speaker 2", text: "We shipped it." },
        ]);
    });

    it("reads plain text as one block per line", () => {
        expect(parseTranscript("First line\n\nSecond line")).toEqual([
            { time: null, speaker: null, text: "First line" },
            { time: null, speaker: null, text: "Second line" },
        ]);
    });
});
