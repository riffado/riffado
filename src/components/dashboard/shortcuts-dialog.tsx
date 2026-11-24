"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Keycap } from "@/components/dashboard/keycap";
import { SKIP_SECONDS } from "@/components/dashboard/recording-player-controls";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** One shortcut row: what it does, the keys shown, and the keydown it answers to. */
export interface Shortcut {
    label: string;
    keys: string[];
    event: { key: string; metaKey?: boolean };
}

export interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
}

/**
 * Every shortcut the library answers to, in the two columns of the
 * sheet. Mirrors `useListKeyboardNav` and `usePlaybackKeyboard`; a test
 * fires each `event` at those hooks so the two can't drift apart.
 */
export const SHORTCUT_COLUMNS: ShortcutGroup[][] = [
    [
        {
            title: "Anywhere",
            shortcuts: [
                {
                    label: "Search and run commands",
                    keys: ["⌘", "K"],
                    event: { key: "k", metaKey: true },
                },
                {
                    label: "Search recordings",
                    keys: ["/"],
                    event: { key: "/" },
                },
                { label: "Open settings", keys: [","], event: { key: "," } },
                { label: "Show shortcuts", keys: ["?"], event: { key: "?" } },
            ],
        },
        {
            title: "Recording list",
            shortcuts: [
                {
                    label: "Select next recording",
                    keys: ["J"],
                    event: { key: "j" },
                },
                {
                    label: "Select previous recording",
                    keys: ["K"],
                    event: { key: "k" },
                },
            ],
        },
    ],
    [
        {
            title: "Player",
            shortcuts: [
                {
                    label: "Play or pause",
                    keys: ["Space"],
                    event: { key: " " },
                },
                {
                    label: `Skip back ${SKIP_SECONDS} seconds`,
                    keys: ["←"],
                    event: { key: "ArrowLeft" },
                },
                {
                    label: `Skip forward ${SKIP_SECONDS} seconds`,
                    keys: ["→"],
                    event: { key: "ArrowRight" },
                },
                {
                    label: "Turn volume up",
                    keys: ["↑"],
                    event: { key: "ArrowUp" },
                },
                {
                    label: "Turn volume down",
                    keys: ["↓"],
                    event: { key: "ArrowDown" },
                },
            ],
        },
    ],
];

const ARROWS: Record<string, { icon: ReactNode; name: string }> = {
    "←": { icon: <ArrowLeft aria-hidden="true" />, name: "Left arrow" },
    "→": { icon: <ArrowRight aria-hidden="true" />, name: "Right arrow" },
    "↑": { icon: <ArrowUp aria-hidden="true" />, name: "Up arrow" },
    "↓": { icon: <ArrowDown aria-hidden="true" />, name: "Down arrow" },
};

function KeyLabel({ name }: { name: string }) {
    const arrow = ARROWS[name];
    if (!arrow) return <Keycap>{name}</Keycap>;
    return (
        <Keycap>
            {arrow.icon}
            <span className="sr-only">{arrow.name}</span>
        </Keycap>
    );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
    // Opened by a key or from a menu, so there is no trigger for Radix to
    // return focus to; put it back where it was.
    const returnFocusTo = useRef<HTMLElement | null>(null);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                instant
                className="gap-0 p-0 sm:max-w-160"
                onOpenAutoFocus={() => {
                    returnFocusTo.current =
                        document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                }}
                onCloseAutoFocus={(e) => {
                    const target = returnFocusTo.current;
                    returnFocusTo.current = null;
                    if (!target?.isConnected) return;
                    e.preventDefault();
                    target.focus();
                }}
            >
                <DialogHeader className="gap-1.5 pt-7 pr-16 pl-7">
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription className="text-ui leading-5">
                        Press ? anytime to see this
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-6 px-7 pt-5 pb-7 sm:flex-row sm:items-start sm:gap-8">
                    {SHORTCUT_COLUMNS.map((column) => (
                        <div
                            key={column[0]?.title}
                            className="flex min-w-0 flex-1 flex-col gap-6"
                        >
                            {column.map((group) => (
                                <section
                                    key={group.title}
                                    aria-label={group.title}
                                >
                                    <h3 className="pb-1.5 text-xs font-medium text-muted-foreground select-none">
                                        {group.title}
                                    </h3>
                                    <ul>
                                        {group.shortcuts.map((shortcut) => (
                                            <li
                                                key={shortcut.label}
                                                className="flex h-8.5 items-center justify-between gap-3 border-b border-surface text-ui leading-5 text-foreground"
                                            >
                                                <span className="truncate">
                                                    {shortcut.label}
                                                </span>
                                                <span className="flex shrink-0 gap-1">
                                                    {shortcut.keys.map((k) => (
                                                        <KeyLabel
                                                            key={k}
                                                            name={k}
                                                        />
                                                    ))}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
