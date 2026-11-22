/**
 * @vitest-environment jsdom
 *
 * First run and not-connected states (W1): without a Plaud connection the
 * dashboard offers Connect Plaud and Upload, never Sync, and runs no sync.
 * With a connection and no recordings it waits for the first sync.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
    // Stable like the real hook; a new object per render would re-run
    // useAutoSync's effects forever.
    useRouter: () => router,
}));

vi.mock("@/components/plaud-connect-tabs", () => ({
    PlaudConnectTabs: ({
        onConnected,
        initialMode = "connector",
    }: {
        onConnected: () => void;
        initialMode?: string;
    }) => (
        <div>
            <p>Connect tab: {initialMode}</p>
            <button type="button" onClick={onConnected}>
                Finish connect
            </button>
        </div>
    ),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { Workstation } from "@/components/dashboard/workstation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
    INITIAL_SETTINGS_DEFAULTS,
    type InitialSettings,
} from "@/lib/settings/initial-settings";
import type { Recording } from "@/types/recording";

const RECORDING: Recording = {
    id: "rec-1",
    filename: "Board meeting",
    duration: 60_000,
    startTime: new Date().toISOString(),
    filesize: 1,
    deviceSn: "",
    hasTranscript: false,
    hasSummary: false,
};

let syncRequests = 0;

function workstationTree({
    hasPlaudConnection,
    recordings = [],
    settings = {},
}: {
    hasPlaudConnection: boolean;
    recordings?: Recording[];
    settings?: Partial<InitialSettings>;
}) {
    return (
        <ConfirmDialogProvider>
            <TooltipProvider>
                <Workstation
                    recordings={recordings}
                    transcriptions={new Map()}
                    userName={null}
                    devices={[]}
                    initialSettings={{
                        ...INITIAL_SETTINGS_DEFAULTS,
                        onboardingCompleted: true,
                        ...settings,
                    }}
                    plaudNeedsReconnect={false}
                    plaudSessionExpiresAt={null}
                    plaudLastSyncAt={null}
                    hasPlaudConnection={hasPlaudConnection}
                    isHosted={false}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>
    );
}

function renderWorkstation(options: {
    hasPlaudConnection: boolean;
    recordings?: Recording[];
    settings?: Partial<InitialSettings>;
}) {
    return render(workstationTree(options));
}

beforeEach(() => {
    syncRequests = 0;
    localStorage.clear();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    vi.spyOn(global, "fetch").mockImplementation((input) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        if (url === "/api/plaud/sync") syncRequests++;
        return Promise.resolve(
            new Response(JSON.stringify({ success: true, newRecordings: 0 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("First run without a Plaud connection", () => {
    it("offers Connect Plaud and Upload, and no Sync button", async () => {
        renderWorkstation({ hasPlaudConnection: false });

        expect(screen.getByText("Your first recording")).not.toBeNull();
        expect(screen.getByText("Connect your Plaud account")).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Sign in with Plaud" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Choose a file" }),
        ).not.toBeNull();
        expect(screen.queryByRole("button", { name: /sync/i })).toBeNull();
    });

    it("uploads a file dropped on the Upload audio card", async () => {
        renderWorkstation({ hasPlaudConnection: false });
        const card = screen
            .getByRole("heading", { name: "Upload audio" })
            .closest("section");
        if (!card) throw new Error("Upload card not found");
        const file = new File(["x"], "memo.m4a", { type: "audio/mp4" });

        fireEvent.drop(card, {
            dataTransfer: { files: [file], types: ["Files"] },
        });

        await waitFor(() =>
            expect(fetch).toHaveBeenCalledWith(
                "/api/recordings/upload",
                expect.objectContaining({ method: "POST" }),
            ),
        );
    });

    it("selects the first recording once the empty library gets one", async () => {
        const options = {
            hasPlaudConnection: false,
            settings: { autoSyncEnabled: false },
        };
        const { rerender } = renderWorkstation(options);
        expect(screen.getByText("Your first recording")).not.toBeNull();

        rerender(workstationTree({ ...options, recordings: [RECORDING] }));

        expect(
            await screen.findByRole("heading", {
                level: 1,
                name: "Board meeting",
            }),
        ).not.toBeNull();
    });

    it("runs no sync on mount even with auto-sync on", async () => {
        renderWorkstation({
            hasPlaudConnection: false,
            settings: { autoSyncEnabled: true, syncOnMount: true },
        });
        await act(async () => {});
        expect(syncRequests).toBe(0);
    });

    it("opens the connect dialog on the matching tab", () => {
        renderWorkstation({ hasPlaudConnection: false });

        fireEvent.click(
            screen.getByRole("button", { name: "Sign in with Plaud" }),
        );
        expect(screen.getByText("Connect tab: connector")).not.toBeNull();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: "Escape",
        });

        fireEvent.click(
            screen.getByRole("button", { name: "Other ways to connect" }),
        );
        expect(screen.getByText("Connect tab: email")).not.toBeNull();
    });

    it("switches to the connected state and syncs once Plaud connects", async () => {
        renderWorkstation({
            hasPlaudConnection: false,
            settings: { autoSyncEnabled: false },
        });

        fireEvent.click(
            screen.getByRole("button", { name: "Sign in with Plaud" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Finish connect" }));

        expect(
            await screen.findByText("Waiting for your first recording"),
        ).not.toBeNull();
        await waitFor(() => expect(syncRequests).toBe(1));
    });

    it("hides sync status in the list header when recordings exist", () => {
        renderWorkstation({
            hasPlaudConnection: false,
            recordings: [RECORDING],
            settings: { autoSyncEnabled: false },
        });

        expect(screen.getAllByText("Board meeting").length).toBeGreaterThan(0);
        expect(screen.queryByRole("button", { name: /sync/i })).toBeNull();
        expect(
            screen.getAllByRole("button", { name: "Upload audio" }).length,
        ).toBeGreaterThan(0);
    });
});

describe("First run with a Plaud connection", () => {
    it("waits for the first recording without promising an interval", () => {
        renderWorkstation({
            hasPlaudConnection: true,
            settings: { autoSyncEnabled: true, syncInterval: 300_000 },
        });

        expect(
            screen.getByText("Waiting for your first recording"),
        ).not.toBeNull();
        expect(
            screen.getByText(
                "New recordings in your Plaud account show up here automatically.",
            ),
        ).not.toBeNull();
        expect(screen.queryByText("Connect your Plaud account")).toBeNull();
        expect(
            screen.getByRole("button", { name: "Choose a file" }),
        ).not.toBeNull();
    });

    it("falls back to the next sync when auto-sync is off", async () => {
        renderWorkstation({
            hasPlaudConnection: true,
            settings: { autoSyncEnabled: false },
        });

        expect(
            screen.getByText(
                "New recordings in your Plaud account show up here after the next sync.",
            ),
        ).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
        await waitFor(() => expect(syncRequests).toBe(1));
    });

    it("shows sync status in the list header when recordings exist", () => {
        renderWorkstation({
            hasPlaudConnection: true,
            recordings: [RECORDING],
            settings: { autoSyncEnabled: false },
        });

        expect(screen.getByRole("button", { name: "Sync now" })).not.toBeNull();
    });
});
