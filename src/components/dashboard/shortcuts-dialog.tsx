"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { uiText } from "@/lib/i18n";

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
        title: uiText("Global shortcuts"),
        rows: [
            { keys: ["⌘", "K"], description: uiText("Command palette") },
            { keys: ["?"], description: uiText("Show this cheatsheet") },
            { keys: [","], description: uiText("Open settings") },
            { keys: ["/"], description: uiText("Focus search") },
        ],
    },
    {
        title: uiText("Recording list"),
        rows: [
            { keys: ["j"], description: uiText("Next recording") },
            { keys: ["k"], description: uiText("Previous recording") },
            // No `Enter → Focus player` row here: selecting a recording
            // via j/k already mounts the player; there's no separate
            // "focus the player" gesture and adding one would conflict
            // with the search box's Enter handler.
        ],
    },
    {
        title: uiText("Player"),
        rows: [
            { keys: [uiText("Space")], description: uiText("Play / pause") },
            { keys: ["←"], description: uiText("Seek back 5s") },
            { keys: ["→"], description: uiText("Seek forward 5s") },
            { keys: ["↑"], description: uiText("Volume up") },
            { keys: ["↓"], description: uiText("Volume down") },
        ],
    },
];

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-foreground shadow-sm">
            {children}
        </kbd>
    );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{uiText("Keyboard shortcuts")}</DialogTitle>
                    <DialogDescription>
                        {uiText(
                            "Power-user shortcuts available across the dashboard.",
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                    {groups.map((group) => (
                        <div key={group.title}>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
