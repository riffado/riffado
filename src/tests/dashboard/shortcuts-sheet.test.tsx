/**
 * @vitest-environment jsdom
 *
 * The shortcuts sheet lists exactly the keys the library answers to:
 * every listed key fires a handler in `useListKeyboardNav` or
 * `usePlaybackKeyboard`, and no other key does.
 */

import {
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    SHORTCUT_COLUMNS,
    ShortcutsDialog,
} from "@/components/dashboard/shortcuts-dialog";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { usePlaybackKeyboard } from "@/hooks/use-playback-keyboard";

afterEach(cleanup);

const SHORTCUTS = SHORTCUT_COLUMNS.flat().flatMap((g) => g.shortcuts);

function mountHooks() {
    const list = {
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onFocusSearch: vi.fn(),
        onOpenPalette: vi.fn(),
        onOpenShortcuts: vi.fn(),
        onOpenSettings: vi.fn(),
    };
    const player = {
        onToggle: vi.fn(),
        onSkip: vi.fn(),
        onVolumeDelta: vi.fn(),
    };
    renderHook(() => {
        useListKeyboardNav(list);
        usePlaybackKeyboard(player);
    });
    const spies = { ...list, ...player };
    const fired = () =>
        Object.entries(spies)
            .filter(([, spy]) => spy.mock.calls.length > 0)
            .map(([name, spy]) => `${name}(${spy.mock.calls[0].join(",")})`);
    const reset = () => {
        for (const spy of Object.values(spies)) spy.mockClear();
    };
    return { fired, reset };
}

describe("Keyboard shortcuts sheet", () => {
    it("lists only keys the library answers to, each doing one thing", () => {
        const { fired, reset } = mountHooks();
        const handled = new Map<string, string[]>();
        for (const shortcut of SHORTCUTS) {
            reset();
            fireEvent.keyDown(document.body, shortcut.event);
            handled.set(shortcut.label, fired());
        }
        for (const [label, handlers] of handled) {
            expect(handlers, label).toHaveLength(1);
        }
        const all = [...handled.values()].flat();
        expect(new Set(all).size).toBe(all.length);
    });

    it("leaves out no key the library answers to", () => {
        const { fired, reset } = mountHooks();
        const listed = new Set(
            SHORTCUTS.filter((s) => !s.event.metaKey).map((s) => s.event.key),
        );
        const candidates = [
            ..."abcdefghijklmnopqrstuvwxyz0123456789/?,.;'[]\\-=`".split(""),
            " ",
            "Enter",
            "Escape",
            "Tab",
            "Home",
            "End",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
        ];
        const unlisted = candidates.filter((key) => {
            reset();
            fireEvent.keyDown(document.body, { key });
            return fired().length > 0 && !listed.has(key);
        });
        expect(unlisted).toEqual([]);
    });

    it("shows two columns of verb-first labels with keycaps", () => {
        render(<ShortcutsDialog open onOpenChange={() => {}} />);
        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getByText("Press ? anytime to see this"),
        ).not.toBeNull();
        for (const title of ["Anywhere", "Recording list", "Player"]) {
            expect(
                within(dialog).getByRole("region", { name: title }),
            ).not.toBeNull();
        }
        for (const shortcut of SHORTCUTS) {
            expect(within(dialog).getByText(shortcut.label)).not.toBeNull();
            expect(shortcut.label[0]).toBe(shortcut.label[0].toUpperCase());
        }
        expect(within(dialog).getByText("Left arrow")).not.toBeNull();
        expect(within(dialog).getByText("Space")).not.toBeNull();
    });
});
