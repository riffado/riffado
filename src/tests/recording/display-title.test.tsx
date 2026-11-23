/**
 * @vitest-environment jsdom
 *
 * Recording titles show without their audio file extension, while the
 * stored name keeps it: renaming edits the bare name and saves it with
 * the original extension unless the user typed one of their own.
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
import { displayTitle } from "@/components/recording/format";
import { RecordingView } from "@/components/recording/recording-view";
import { RecordingTitle } from "@/components/recordings/recording-title";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
    renamedRecordingFilename,
    splitAudioExtension,
} from "@/lib/recordings/filename";
import type { Recording } from "@/types/recording";

describe("displayTitle", () => {
    it("strips a known audio extension, case-insensitively", () => {
        expect(displayTitle("Board meeting.m4a")).toBe("Board meeting");
        expect(displayTitle("Call.MP3")).toBe("Call");
        for (const ext of [
            ".mp3",
            ".mp4",
            ".m4a",
            ".wav",
            ".ogg",
            ".opus",
            ".webm",
            ".aac",
            ".flac",
        ]) {
            expect(displayTitle(`Note${ext}`)).toBe("Note");
        }
    });

    it("leaves names without a known audio extension unchanged", () => {
        expect(displayTitle("Q4 board meeting")).toBe("Q4 board meeting");
        expect(displayTitle("notes.txt")).toBe("notes.txt");
        expect(displayTitle("v2.1 planning")).toBe("v2.1 planning");
        expect(displayTitle("archive.mp3.zip")).toBe("archive.mp3.zip");
    });

    it("only strips the last extension", () => {
        expect(displayTitle("take.mp3.wav")).toBe("take.mp3");
    });

    it("never returns an empty string", () => {
        expect(displayTitle(".mp3")).toBe(".mp3");
        expect(displayTitle("  .wav")).toBe("  .wav");
        expect(displayTitle("")).toBe("");
    });
});

describe("splitAudioExtension", () => {
    it("keeps the stored casing of the extension", () => {
        expect(splitAudioExtension("Call.M4A")).toEqual({
            base: "Call",
            extension: ".M4A",
        });
        expect(splitAudioExtension("Call")).toEqual({
            base: "Call",
            extension: "",
        });
    });
});

describe("renamedRecordingFilename", () => {
    it("puts the stored extension back on the typed name", () => {
        expect(renamedRecordingFilename("Call.m4a", "Client call")).toBe(
            "Client call.m4a",
        );
        expect(renamedRecordingFilename("Call.M4A", "Client call")).toBe(
            "Client call.M4A",
        );
    });

    it("doesn't double an audio extension the user typed", () => {
        expect(renamedRecordingFilename("Call.m4a", "Client call.m4a")).toBe(
            "Client call.m4a",
        );
        expect(renamedRecordingFilename("Call.m4a", "Client call.WAV")).toBe(
            "Client call.WAV",
        );
    });

    it("saves the typed name as is when the stored one had no extension", () => {
        expect(renamedRecordingFilename("Call", "Client call")).toBe(
            "Client call",
        );
    });
});

describe("RecordingTitle rename", () => {
    let patched: unknown[] = [];

    beforeEach(() => {
        patched = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
                const body = JSON.parse(String(init?.body ?? "{}"));
                patched.push(body);
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }),
        );
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    function renderTitle(filename: string, onRenamed = vi.fn()) {
        render(
            <RecordingTitle
                recordingId="rec-1"
                filename={filename}
                onRenamed={onRenamed}
            />,
        );
        return onRenamed;
    }

    it("shows and edits the name without its extension, then keeps it on save", async () => {
        const onRenamed = renderTitle("Board meeting.m4a");
        const button = screen.getByRole("button", {
            name: "Rename Board meeting",
        });
        expect(button.textContent).toBe("Board meeting");

        fireEvent.click(button);
        const input = screen.getByRole("textbox", {
            name: "Recording name",
        }) as HTMLInputElement;
        expect(input.value).toBe("Board meeting");

        fireEvent.change(input, { target: { value: "Q4 review" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() =>
            expect(onRenamed).toHaveBeenCalledWith("Q4 review.m4a"),
        );
        expect(patched).toEqual([{ filename: "Q4 review.m4a" }]);
    });

    it("doesn't double an extension the user typed", async () => {
        const onRenamed = renderTitle("Board meeting.m4a");
        fireEvent.click(screen.getByRole("button"));
        const input = screen.getByRole("textbox", { name: "Recording name" });
        fireEvent.change(input, { target: { value: "Q4 review.m4a" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() =>
            expect(onRenamed).toHaveBeenCalledWith("Q4 review.m4a"),
        );
        expect(patched).toEqual([{ filename: "Q4 review.m4a" }]);
    });

    it("saves nothing when the bare name is unchanged", () => {
        const onRenamed = renderTitle("Board meeting.m4a");
        fireEvent.click(screen.getByRole("button"));
        fireEvent.keyDown(
            screen.getByRole("textbox", { name: "Recording name" }),
            { key: "Enter" },
        );
        expect(patched).toEqual([]);
        expect(onRenamed).not.toHaveBeenCalled();
    });
});

describe("RecordingView title and top bar", () => {
    const recording: Recording = {
        id: "rec-1",
        filename: "Board meeting.m4a",
        duration: 60_000,
        startTime: new Date().toISOString(),
        filesize: 1,
        deviceSn: "local",
        hasTranscript: false,
        hasSummary: false,
    };

    beforeEach(() => {
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        );
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ summary: null }), {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    }),
            ),
        );
        vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
            () => {},
        );
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
            () => {},
        );
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function renderView() {
        render(
            <ConfirmDialogProvider>
                <TooltipProvider>
                    <RecordingView
                        recording={recording}
                        transcripts={[]}
                        isTranscribing={false}
                        onTranscribe={() => {}}
                        onTranscribeComplete={() => {}}
                        onDelete={async () => {}}
                        summaryProviderState="ready"
                        player={{ scrubberStyle: "waveform" }}
                    />
                </TooltipProvider>
            </ConfirmDialogProvider>,
        );
    }

    it("titles the reader without the extension", () => {
        renderView();
        expect(
            screen.getByRole("article", { name: "Board meeting" }),
        ).not.toBeNull();
        expect(screen.queryByText("Board meeting.m4a")).toBeNull();
    });

    it("has no standalone download button; Download audio stays in More", async () => {
        renderView();
        expect(
            screen.queryByRole("link", { name: "Download original audio" }),
        ).toBeNull();

        fireEvent.keyDown(
            screen.getByRole("button", { name: "More actions" }),
            { key: "Enter" },
        );
        await waitFor(() =>
            expect(
                screen.getByRole("menuitem", { name: "Download audio" }),
            ).not.toBeNull(),
        );
    });

    it("names the recording without its extension when asking to delete", async () => {
        renderView();
        fireEvent.keyDown(
            screen.getByRole("button", { name: "More actions" }),
            { key: "Enter" },
        );
        const item = await screen.findByRole("menuitem", {
            name: "Delete recording",
        });
        fireEvent.click(item);
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog.textContent).toContain("Board meeting is removed");
        expect(dialog.textContent).not.toContain(".m4a");
    });
});
