"use client";

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

interface ShortcutRow {
    keys: string[];
    description: string;
}

const groups: { title: string; rows: ShortcutRow[] }[] = [
    {
        title: "Global",
        rows: [
            { keys: ["⌘", "K"], description: "Command palette" },
            { keys: ["?"], description: "Show this cheatsheet" },
            { keys: [","], description: "Open settings" },
            { keys: ["/"], description: "Focus search" },
        ],
    },
    {
        title: "Recording list",
        rows: [
            { keys: ["j"], description: "Next recording" },
            { keys: ["k"], description: "Previous recording" },
            // No `Enter → Focus player` row here: selecting a recording
            // via j/k already mounts the player; there's no separate
            // "focus the player" gesture and adding one would conflict
            // with the search box's Enter handler.
        ],
    },
    {
        title: "Player",
        rows: [
            { keys: ["Space"], description: "Play / pause" },
            { keys: ["←"], description: "Skip back 10 seconds" },
            { keys: ["→"], description: "Skip forward 10 seconds" },
            { keys: ["↑"], description: "Volume up" },
            { keys: ["↓"], description: "Volume down" },
        ],
    },
];

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs text-foreground shadow-sm select-none">
            {children}
        </kbd>
    );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription>
                        Shortcuts that work across the library
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                    {groups.map((group) => (
                        <div key={group.title}>
                            <h3 className="mb-2 text-xs font-medium text-muted-foreground select-none">
                                {group.title}
                            </h3>
                            <ul className="space-y-1.5">
                                {group.rows.map((row) => (
                                    <li
                                        key={row.description}
                                        className="flex items-center justify-between text-sm"
                                    >
                                        <span className="text-foreground">
                                            {row.description}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            {row.keys.map((k) => (
                                                <Kbd key={k}>{k}</Kbd>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
