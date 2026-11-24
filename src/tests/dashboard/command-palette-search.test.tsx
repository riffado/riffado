/**
 * @vitest-environment jsdom
 *
 * ⌘K finds recordings exactly like the library search: case-insensitive
 * substring on the stored filename and the full transcript, so the same
 * query returns the same recordings in both places. Actions and themes
 * stay findable by their labels.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { RecordingList } from "@/components/dashboard/recording-list";
import type { RecordingRowActions } from "@/components/dashboard/recording-row";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Recording } from "@/types/recording";

const ROW_ACTIONS: RecordingRowActions = {
    browser: {
        runningId: null,
        isRunning: false,
        phaseFor: () => "idle",
        start: async () => {},
    },
    summaryPrompts: { options: [], selectedId: "general", select: () => {} },
    summarizingIds: new Set(),
    serverTranscription: true,
    onRename: () => {},
    onTranscribe: () => {},
    onSummarize: () => {},
    onDeleteSummary: () => {},
};

function recording(id: string, filename: string, hoursAgo: number): Recording {
    return {
        id,
        filename,
        duration: 60_000,
        startTime: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
        filesize: 1,
        deviceSn: "SN-1",
        hasTranscript: true,
        hasSummary: false,
    };
}

const RECORDINGS = [
    recording("a", "Board meeting.m4a", 1),
    recording("b", "Walking notes", 2),
    recording("c", "Client call", 3),
    recording("d", "Standup", 4),
];

const FILLER = "and then we went over the agenda again ".repeat(8);
const TRANSCRIPTIONS = new Map([
    ["a", { text: "[00:00] Revenue closed at four point one million." }],
    // The match sits far past the 140-character snippet.
    ["b", { text: `${FILLER} remember the Board deck for Friday` }],
    ["c", { text: "Pricing and REVENUE targets for next quarter." }],
]);

function listIds(query: string): string[] {
    const { unmount, container } = render(
        <ConfirmDialogProvider>
            <TooltipProvider>
                <RecordingList
                    recordings={RECORDINGS}
                    transcriptions={TRANSCRIPTIONS}
                    currentRecording={null}
                    pendingUploads={[]}
                    inFlightActions={new Map()}
                    deviceNames={new Map()}
                    query={query}
                    onQueryChange={() => {}}
                    filter="all"
                    onFilterChange={() => {}}
                    headerActions={null}
                    banner={null}
                    onSelect={() => {}}
                    onDelete={async () => {}}
                    rowActions={ROW_ACTIONS}
                    initialDateTimeFormat="relative"
                    initialSortOrder="newest"
                    initialDensity="comfortable"
                    initialChunkSize={50}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>,
    );
    const ids = Array.from(
        container.querySelectorAll<HTMLAnchorElement>("a[href^='?r=']"),
    ).map((a) => decodeURIComponent(a.getAttribute("href")?.slice(3) ?? ""));
    unmount();
    return ids;
}

function renderPalette() {
    return render(
        <CommandPalette
            open
            onOpenChange={() => {}}
            recordings={RECORDINGS}
            transcriptions={TRANSCRIPTIONS}
            currentRecording={null}
            inFlightActions={new Map()}
            currentTheme="system"
            dateTimeFormat="relative"
            onSelectRecording={() => {}}
            onSync={() => {}}
            onUpload={() => {}}
            onOpenSettings={() => {}}
            onOpenShortcuts={() => {}}
            onSetTheme={() => {}}
        />,
    );
}

function typeInPalette(query: string) {
    const input = screen.getByPlaceholderText(
        "Search recordings, transcripts and actions",
    );
    act(() => {
        fireEvent.change(input, { target: { value: query } });
    });
}

function paletteIds(): string[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            "[cmdk-item][data-value^='recording:']",
        ),
    ).map((el) => el.dataset.value?.slice("recording:".length) ?? "");
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
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("⌘K and the library search match the same recordings", () => {
    const queries = [
        "board",
        "  BOARD ",
        "revenue",
        "friday",
        ".m4a",
        "notes",
        "brdmtg",
        "nothing like this",
    ];

    for (const query of queries) {
        it(`"${query}"`, () => {
            const fromList = listIds(query);
            renderPalette();
            typeInPalette(query);
            expect(paletteIds().sort()).toEqual([...fromList].sort());
        });
    }

    it("finds a transcript match past the snippet in both places", () => {
        expect(listIds("friday")).toEqual(["b"]);
        renderPalette();
        typeInPalette("friday");
        expect(paletteIds()).toEqual(["b"]);
    });

    it("no longer fuzzy-matches recordings", () => {
        renderPalette();
        typeInPalette("brdmtg");
        expect(paletteIds()).toEqual([]);
    });

    it("shows every recording in list order with an empty query", () => {
        renderPalette();
        expect(paletteIds()).toEqual(["a", "b", "c", "d"]);
    });
});

describe("⌘K actions", () => {
    it("finds actions and themes by their labels", () => {
        renderPalette();
        typeInPalette("settings");
        expect(screen.getByText("Open settings")).not.toBeNull();
        expect(paletteIds()).toEqual([]);

        typeInPalette("dark");
        expect(screen.getByText("Dark")).not.toBeNull();
        expect(screen.queryByText("Upload audio")).toBeNull();
    });

    it("says when nothing matches", () => {
        renderPalette();
        typeInPalette("zzzz");
        expect(screen.getByText("No matches.")).not.toBeNull();
    });
});
