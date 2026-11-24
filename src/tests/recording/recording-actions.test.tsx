/**
 * @vitest-environment jsdom
 *
 * Recording action list (DESIGN.md "Menus (web)"): one list, the same
 * from the More button, a row's "…" button and a right-click. Items that
 * don't apply are hidden, order is fixed, the summary submenu lists your
 * own prompts after a separator, and Delete opens its confirm only after
 * the menu has closed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    type RecordingActionHandlers,
    RecordingActionsContent,
    type RecordingActionsState,
} from "@/components/recording/recording-actions";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
    DropdownMenu,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PROMPTS = [
    { id: "general", name: "General Summary", isPreset: true },
    { id: "meeting", name: "Meeting Notes", isPreset: true },
    { id: "custom-standup", name: "Standup recap", isPreset: false },
];

function state(
    overrides: Partial<RecordingActionsState> = {},
): RecordingActionsState {
    return {
        recordingId: "rec-1",
        hasTranscript: false,
        hasSummary: false,
        transcribing: null,
        browserAvailable: true,
        isSummarizing: false,
        summaryPrompts: PROMPTS,
        currentPromptId: "general",
        ...overrides,
    };
}

function handlers(): RecordingActionHandlers {
    return {
        onRename: vi.fn(),
        onTranscribe: vi.fn(),
        onTranscribeInBrowser: vi.fn(),
        onSummarize: vi.fn(),
        onDeleteSummary: vi.fn(),
        onDelete: vi.fn(),
    };
}

function renderDropdown(
    s: RecordingActionsState,
    h: RecordingActionHandlers = handlers(),
) {
    render(
        <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>More actions</DropdownMenuTrigger>
            <RecordingActionsContent flavour="dropdown" {...s} {...h} />
        </DropdownMenu>,
    );
    return h;
}

/** Top-level menu as labels, with "|" for each separator. */
function menuOutline(menu: HTMLElement = screen.getByRole("menu")): string[] {
    return Array.from(menu.children).map((el) =>
        el.getAttribute("role") === "separator"
            ? "|"
            : (el.textContent ?? "").trim(),
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
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("RecordingActionsContent visibility and order", () => {
    it("offers transcription but no summary actions without a transcript", () => {
        renderDropdown(state());
        expect(menuOutline()).toEqual([
            "Rename",
            "Download audio",
            "|",
            "Transcribe",
            "Transcribe in browser",
            "|",
            "Delete recording",
        ]);
    });

    it("offers Summarize once there is a transcript", () => {
        renderDropdown(state({ hasTranscript: true }));
        expect(menuOutline()).toEqual([
            "Rename",
            "Download audio",
            "|",
            "Re-transcribe",
            "Transcribe in browser",
            "|",
            "Summarize",
            "|",
            "Delete recording",
        ]);
    });

    it("offers Regenerate and Delete summary once there is a summary", () => {
        renderDropdown(state({ hasTranscript: true, hasSummary: true }));
        expect(menuOutline()).toEqual([
            "Rename",
            "Download audio",
            "|",
            "Re-transcribe",
            "Transcribe in browser",
            "|",
            "Regenerate summary",
            "Delete summary",
            "|",
            "Delete recording",
        ]);
    });

    it("has no Open item", () => {
        renderDropdown(state({ hasTranscript: true, hasSummary: true }));
        expect(screen.queryByRole("menuitem", { name: /open/i })).toBeNull();
    });

    it("links Download audio to the recording's audio", () => {
        renderDropdown(state());
        const link = screen.getByRole("menuitem", { name: "Download audio" });
        expect(link.tagName).toBe("A");
        expect(link.getAttribute("href")).toContain("rec-1");
        expect(link.hasAttribute("download")).toBe(true);
    });

    it("shows a running transcription disabled and hides the other way", () => {
        renderDropdown(state({ hasTranscript: true, transcribing: "server" }));
        const running = screen.getByRole("menuitem", {
            name: "Transcribing…",
        });
        expect(running.getAttribute("aria-disabled")).toBe("true");
        expect(
            screen.queryByRole("menuitem", { name: "Transcribe in browser" }),
        ).toBeNull();
        expect(
            screen.queryByRole("menuitem", { name: "Re-transcribe" }),
        ).toBeNull();
    });

    it("hides Transcribe in browser while another recording runs one", () => {
        renderDropdown(state({ browserAvailable: false }));
        expect(
            screen.queryByRole("menuitem", { name: "Transcribe in browser" }),
        ).toBeNull();
        expect(
            screen.getByRole("menuitem", { name: "Transcribe" }),
        ).not.toBeNull();
    });

    it("hides server transcription when nothing can transcribe on the server", () => {
        renderDropdown(
            state({ hasTranscript: true, serverTranscription: false }),
        );
        expect(menuOutline()).toEqual([
            "Rename",
            "Download audio",
            "|",
            "Transcribe in browser",
            "|",
            "Summarize",
            "|",
            "Delete recording",
        ]);
    });

    it("shows a running summary disabled", () => {
        renderDropdown(state({ hasTranscript: true, isSummarizing: true }));
        expect(
            screen
                .getByRole("menuitem", { name: "Summarizing…" })
                .getAttribute("aria-disabled"),
        ).toBe("true");
    });
});

describe("RecordingActionsContent summary styles", () => {
    it("lists presets, then your own prompts after a separator, with a check on the current one", async () => {
        const h = renderDropdown(
            state({ hasTranscript: true, currentPromptId: "meeting" }),
        );
        const trigger = screen.getByRole("menuitem", { name: "Summarize" });
        fireEvent.keyDown(trigger, { key: "ArrowRight" });

        const sub = await waitFor(() => {
            const menus = screen.getAllByRole("menu");
            expect(menus.length).toBe(2);
            return menus[1];
        });
        expect(menuOutline(sub)).toEqual([
            "General Summary",
            "Meeting Notes(current style)",
            "|",
            "Standup recap",
        ]);

        fireEvent.click(
            within(sub).getByRole("menuitem", { name: "Standup recap" }),
        );
        expect(h.onSummarize).toHaveBeenCalledWith("custom-standup");
    });

    it("leaves out the separator when you have no prompts of your own", async () => {
        renderDropdown(
            state({
                hasTranscript: true,
                summaryPrompts: PROMPTS.filter((p) => p.isPreset),
            }),
        );
        fireEvent.keyDown(screen.getByRole("menuitem", { name: "Summarize" }), {
            key: "ArrowRight",
        });
        const sub = await waitFor(() => screen.getAllByRole("menu")[1]);
        expect(menuOutline(sub)).toEqual([
            "General Summary(current style)",
            "Meeting Notes",
        ]);
    });
});

describe("RecordingActionsContent focus handoff", () => {
    it("closes the menu before asking to delete", async () => {
        const h = handlers();
        let menuOpenAtDelete: boolean | null = null;
        h.onDelete = vi.fn(() => {
            menuOpenAtDelete = screen.queryByRole("menu") !== null;
        });
        renderDropdown(state(), h);

        fireEvent.click(
            screen.getByRole("menuitem", { name: "Delete recording" }),
        );

        await waitFor(() => expect(h.onDelete).toHaveBeenCalledTimes(1));
        expect(menuOpenAtDelete).toBe(false);
        expect(document.activeElement?.textContent).toBe("More actions");
    });

    it("starts rename after the menu closes", async () => {
        const h = renderDropdown(state());
        fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
        await waitFor(() => expect(h.onRename).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("menu")).toBeNull();
    });
});

describe("RecordingActionsContent as a right-click menu", () => {
    it("shows the same list and returns focus to the row", async () => {
        const h = handlers();
        render(
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <button type="button">Q4 board meeting</button>
                </ContextMenuTrigger>
                <RecordingActionsContent
                    flavour="context"
                    returnFocusTo={{
                        get current() {
                            return screen.getByRole("button", {
                                name: "Q4 board meeting",
                            });
                        },
                    }}
                    {...state({ hasTranscript: true, hasSummary: true })}
                    {...h}
                />
            </ContextMenu>,
        );

        const row = screen.getByRole("button", { name: "Q4 board meeting" });
        fireEvent.contextMenu(row);
        expect(row.getAttribute("data-state")).toBe("open");
        expect(menuOutline()).toEqual([
            "Rename",
            "Download audio",
            "|",
            "Re-transcribe",
            "Transcribe in browser",
            "|",
            "Regenerate summary",
            "Delete summary",
            "|",
            "Delete recording",
        ]);

        fireEvent.click(
            screen.getByRole("menuitem", { name: "Delete recording" }),
        );
        await waitFor(() => expect(h.onDelete).toHaveBeenCalledTimes(1));
        expect(document.activeElement).toBe(row);
    });
});

describe("recording menus", () => {
    it("use no Sparkles icon", () => {
        for (const file of [
            "src/components/recording/recording-actions.tsx",
            "src/components/recording/recording-top-bar.tsx",
            "src/components/dashboard/recording-row.tsx",
        ]) {
            const source = readFileSync(resolve(process.cwd(), file), "utf8");
            expect(source, file).not.toMatch(/Sparkles/);
        }
    });
});
