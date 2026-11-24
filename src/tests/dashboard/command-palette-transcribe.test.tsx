/**
 * @vitest-environment jsdom
 *
 * ⌘K's Transcribe chip: only the highlighted row offers it, only when
 * that recording has no transcript and nothing is in flight, and only
 * when server transcription is available. ⌘↵ transcribes the same row.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/dashboard/command-palette";
import type { Recording } from "@/types/recording";

function recording(
    id: string,
    filename: string,
    hasTranscript: boolean,
): Recording {
    return {
        id,
        filename,
        duration: 8 * 60_000,
        startTime: new Date().toISOString(),
        filesize: 1,
        deviceSn: "SN-1",
        hasTranscript,
        hasSummary: false,
    };
}

const RECORDINGS = [
    recording("a", "Walking notes.m4a", false),
    recording("b", "Board meeting.m4a", true),
    recording("c", "Client call.m4a", false),
];

function renderPalette(
    props: {
        onTranscribeRecording?: (id: string) => void;
        inFlight?: Map<string, "transcribing" | "summarizing">;
        current?: Recording | null;
    } = {},
) {
    return render(
        <CommandPalette
            open
            onOpenChange={() => {}}
            recordings={RECORDINGS}
            transcriptions={
                new Map([["b", { text: "Revenue closed at four million" }]])
            }
            currentRecording={props.current ?? null}
            inFlightActions={props.inFlight ?? new Map()}
            currentTheme="system"
            dateTimeFormat="relative"
            onSelectRecording={() => {}}
            onUpload={() => {}}
            onOpenSettings={() => {}}
            onOpenShortcuts={() => {}}
            onSetTheme={() => {}}
            onTranscribeRecording={props.onTranscribeRecording}
        />,
    );
}

function input() {
    return screen.getByPlaceholderText(
        "Search recordings, transcripts and actions",
    );
}

function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
        fireEvent.keyDown(input(), { key, ...init });
    });
}

function chips(): string[] {
    return screen
        .queryAllByRole("button", { name: /^Transcribe / })
        .map((b) => b.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("⌘K Transcribe chip", () => {
    it("shows only on the highlighted untranscribed row", () => {
        renderPalette({ onTranscribeRecording: () => {} });
        expect(chips()).toEqual(["Transcribe Walking notes"]);

        press("ArrowDown");
        expect(chips()).toEqual([]);

        press("ArrowDown");
        expect(chips()).toEqual(["Transcribe Client call"]);
    });

    it("never shows without server transcription", () => {
        renderPalette();
        expect(chips()).toEqual([]);
        press("ArrowDown");
        press("ArrowDown");
        expect(chips()).toEqual([]);
        expect(screen.queryByText("Transcribe")).toBeNull();
    });

    it("never shows while the recording is already transcribing", () => {
        renderPalette({
            onTranscribeRecording: () => {},
            inFlight: new Map([["a", "transcribing"]]),
        });
        expect(chips()).toEqual([]);
        expect(screen.getByText("Transcribing…")).not.toBeNull();
    });

    it("names the key in the footer only while the chip shows", () => {
        renderPalette({ onTranscribeRecording: () => {} });
        const footerHint = () =>
            screen
                .queryAllByText("Transcribe")
                .filter((el) => !el.closest("button"));
        expect(footerHint()).toHaveLength(1);
        press("ArrowDown");
        expect(footerHint()).toHaveLength(0);
    });

    it("transcribes the highlighted row with ⌘↵ and from the chip", () => {
        const onTranscribe = vi.fn();
        renderPalette({ onTranscribeRecording: onTranscribe });
        press("Enter", { metaKey: true });
        expect(onTranscribe).toHaveBeenCalledWith("a");

        press("ArrowDown");
        press("ArrowDown");
        fireEvent.click(
            screen.getByRole("button", { name: "Transcribe Client call" }),
        );
        expect(onTranscribe).toHaveBeenLastCalledWith("c");
    });

    it("shows a snippet or Not transcribed yet, and spoken duration", () => {
        renderPalette();
        expect(
            screen.getByText("Revenue closed at four million"),
        ).not.toBeNull();
        expect(screen.getAllByText("Not transcribed yet")).toHaveLength(2);
        expect(screen.getAllByText("8 min")).toHaveLength(3);
        expect(screen.getByText("Walking notes")).not.toBeNull();
    });

    it("marks the open recording", () => {
        renderPalette({ current: RECORDINGS[1] });
        const rows = document.querySelectorAll("[cmdk-item][data-current]");
        expect(rows).toHaveLength(1);
        expect((rows[0] as HTMLElement).dataset.value).toBe("recording:b");
    });
});
