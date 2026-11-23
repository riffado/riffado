/**
 * @vitest-environment jsdom
 *
 * Library sidebar and list (W1 redesign): the sidebar strips populated
 * chrome on first run, recorder status follows the Plaud connection, and
 * the Untranscribed filter shows only recordings without a transcript.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { LibrarySidebar } from "@/components/dashboard/library-sidebar";
import {
    type LibraryFilter,
    RecordingList,
} from "@/components/dashboard/recording-list";
import type { RecordingRowActions } from "@/components/dashboard/recording-row";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RecorderDevice } from "@/types/device";
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

const DEVICE: RecorderDevice = {
    serialNumber: "SN-1",
    name: "Note Pro",
    model: "note",
};

function renderSidebar(props: {
    recordingCount: number;
    devices: RecorderDevice[];
    plaudNeedsReconnect?: boolean;
}) {
    return render(
        <TooltipProvider>
            <LibrarySidebar
                recordingCount={props.recordingCount}
                devices={props.devices}
                plaudNeedsReconnect={props.plaudNeedsReconnect ?? false}
                query=""
                onQueryChange={() => {}}
                onEnterSelectFirst={() => {}}
                searchRef={createRef<HTMLInputElement>()}
                onShowLibrary={() => {}}
                isAdmin={false}
                userEmail="kacper@example.com"
                userName="Kacper Smith"
                isHosted={false}
                onOpenSettings={() => {}}
                onSettingsIntent={() => {}}
                onOpenShortcuts={() => {}}
            />
        </TooltipProvider>,
    );
}

function recording(overrides: Partial<Recording>): Recording {
    return {
        id: "r",
        filename: "Recording",
        duration: 60_000,
        startTime: new Date().toISOString(),
        filesize: 1,
        deviceSn: "SN-1",
        hasTranscript: false,
        hasSummary: false,
        ...overrides,
    };
}

function renderList(recordings: Recording[], filter: LibraryFilter) {
    return render(
        <ConfirmDialogProvider>
            <TooltipProvider>
                <RecordingList
                    recordings={recordings}
                    transcriptions={new Map()}
                    currentRecording={null}
                    pendingUploads={[]}
                    inFlightActions={new Map()}
                    deviceNames={new Map([["SN-1", "Note Pro"]])}
                    query=""
                    onQueryChange={() => {}}
                    filter={filter}
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
}

beforeEach(() => {
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

describe("LibrarySidebar", () => {
    it("hides the count and Recorders section on first run", () => {
        renderSidebar({ recordingCount: 0, devices: [] });
        expect(screen.queryByText("Recorders")).toBeNull();
        expect(screen.queryByText("0")).toBeNull();
        expect(screen.getByText("Library")).not.toBeNull();
    });

    it("lists recorders with a Via Plaud status while connected", () => {
        renderSidebar({ recordingCount: 12, devices: [DEVICE] });
        expect(screen.getByText("12")).not.toBeNull();
        expect(screen.getByText("Note Pro")).not.toBeNull();
        expect(screen.getByText("Via Plaud")).not.toBeNull();
    });

    it("shows recorders as not syncing when Plaud signed the user out", () => {
        renderSidebar({
            recordingCount: 12,
            devices: [DEVICE],
            plaudNeedsReconnect: true,
        });
        expect(screen.getByText("Not syncing")).not.toBeNull();
    });

    it("shows initials and name in the account row", () => {
        renderSidebar({ recordingCount: 1, devices: [] });
        expect(screen.getByText("KS")).not.toBeNull();
        expect(screen.getByText("Kacper Smith")).not.toBeNull();
    });
});

describe("RecordingList filters", () => {
    const recordings = [
        recording({ id: "a", filename: "Board meeting", hasTranscript: true }),
        recording({ id: "b", filename: "Walking notes" }),
    ];

    it("shows every recording under All", () => {
        renderList(recordings, "all");
        expect(screen.getByText("Board meeting")).not.toBeNull();
        expect(screen.getByText("Walking notes")).not.toBeNull();
        expect(screen.getByText("Not transcribed yet")).not.toBeNull();
    });

    it("shows only recordings without a transcript under Untranscribed", () => {
        renderList(recordings, "untranscribed");
        expect(screen.queryByText("Board meeting")).toBeNull();
        expect(screen.getByText("Walking notes")).not.toBeNull();
    });

    it("reports the filter choice", () => {
        const onFilterChange = vi.fn();
        render(
            <ConfirmDialogProvider>
                <TooltipProvider>
                    <RecordingList
                        recordings={recordings}
                        transcriptions={new Map()}
                        currentRecording={null}
                        pendingUploads={[]}
                        inFlightActions={new Map()}
                        deviceNames={new Map()}
                        query=""
                        onQueryChange={() => {}}
                        filter="all"
                        onFilterChange={onFilterChange}
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
        fireEvent.click(screen.getByRole("radio", { name: "Untranscribed" }));
        expect(onFilterChange).toHaveBeenCalledWith("untranscribed");
    });

    it("puts the recorder name in the metadata line", () => {
        renderList(recordings, "all");
        expect(screen.getAllByText(/Note Pro$/).length).toBe(2);
    });
});
