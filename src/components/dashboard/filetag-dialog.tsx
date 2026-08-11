"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    DEFAULT_FILETAG_COLOR,
    DEFAULT_FILETAG_ICON,
    getFiletagIcon,
    PLAUD_FILETAG_COLORS,
    PLAUD_FILETAG_ICON_NAMES,
} from "@/lib/plaud/filetag-icons";
import { cn } from "@/lib/utils";
import type { Filetag } from "@/types/filetag";

const MAX_NAME_LENGTH = 50;

/** Human-readable label for a Plaud icon name (e.g. "iconfont_folder_booknote" -> "booknote"). */
function iconLabel(iconName: string): string {
    return iconName
        .replace(/^iconfont_(a_)?(folder(icon)?_)?/, "")
        .replace(/_/g, " ");
}

interface FiletagDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Directory being edited, or null to create a new one. */
    editing: Filetag | null;
    /** Called after a successful create/update (refresh server data). */
    onSaved: () => void;
}

/**
 * Create/edit dialog for a Plaud directory: name, the official 7-swatch
 * palette, and the Plaud icon set rendered via the lucide mapping (the
 * stored value is the Plaud icon name, so the official app shows the
 * same icon).
 */
export function FiletagDialog({
    open,
    onOpenChange,
    editing,
    onSaved,
}: FiletagDialogProps) {
    const [name, setName] = useState("");
    const [icon, setIcon] = useState<string>(DEFAULT_FILETAG_ICON);
    const [color, setColor] = useState<string>(DEFAULT_FILETAG_COLOR);
    const [saving, setSaving] = useState(false);
    const [inlineError, setInlineError] = useState<string | null>(null);

    // Re-seed form state each time the dialog opens (create -> defaults,
    // edit -> current values).
    useEffect(() => {
        if (!open) return;
        setName(editing?.name ?? "");
        setIcon(editing?.icon ?? DEFAULT_FILETAG_ICON);
        setColor(editing?.color ?? DEFAULT_FILETAG_COLOR);
        setInlineError(null);
        setSaving(false);
    }, [open, editing]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed || saving) return;

        setSaving(true);
        setInlineError(null);
        try {
            const res = await fetch(
                editing ? `/api/filetags/${editing.id}` : "/api/filetags",
                {
                    method: editing ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: trimmed, icon, color }),
                },
            );

            if (res.ok) {
                toast.success(
                    editing ? "Directory updated" : "Directory created",
                );
                onOpenChange(false);
                onSaved();
                return;
            }

            const data = (await res.json().catch(() => ({}))) as {
                error?: string;
            };
            if (res.status === 409) {
                setInlineError(
                    data.error ?? "A directory with this name already exists.",
                );
            } else if (res.status === 502 || res.status === 429) {
                toast.error(
                    "Plaud is unreachable right now. Please try again later.",
                );
            } else {
                toast.error(data.error ?? "Failed to save directory");
            }
        } catch {
            toast.error("Failed to save directory");
        } finally {
            setSaving(false);
        }
    };

    const SelectedIcon = getFiletagIcon(icon);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {editing ? "Edit directory" : "New directory"}
                    </DialogTitle>
                    <DialogDescription>
                        {editing
                            ? "Changes apply in Riffado and in the Plaud app."
                            : "Organize recordings into a directory, synced with the Plaud app."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="filetag-name">Name</Label>
                        <Input
                            id="filetag-name"
                            value={name}
                            maxLength={MAX_NAME_LENGTH}
                            placeholder="e.g. Meetings"
                            onChange={(e) => {
                                setName(e.target.value);
                                setInlineError(null);
                            }}
                            autoFocus
                        />
                        {inlineError && (
                            <p className="text-xs text-destructive">
                                {inlineError}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>Color</Label>
                        <div className="flex items-center gap-2">
                            {PLAUD_FILETAG_COLORS.map((swatch) => (
                                <button
                                    key={swatch}
                                    type="button"
                                    aria-label={`Color ${swatch}`}
                                    aria-pressed={color === swatch}
                                    onClick={() => setColor(swatch)}
                                    className={cn(
                                        "size-6 rounded-full transition-transform hover:scale-110",
                                        color === swatch &&
                                            "ring-2 ring-ring ring-offset-2 ring-offset-background",
                                    )}
                                    style={{ backgroundColor: swatch }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Icon</Label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-between font-normal"
                                >
                                    <span className="flex items-center gap-2">
                                        <SelectedIcon className="size-4" />
                                        <span className="capitalize">
                                            {iconLabel(icon)}
                                        </span>
                                    </span>
                                    <ChevronDown className="size-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="w-(--radix-dropdown-menu-trigger-width) p-2"
                            >
                                <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
                                    {PLAUD_FILETAG_ICON_NAMES.map(
                                        (iconName) => {
                                            const Icon =
                                                getFiletagIcon(iconName);
                                            const selected = icon === iconName;
                                            return (
                                                <DropdownMenuItem
                                                    key={iconName}
                                                    aria-label={iconName}
                                                    onSelect={() =>
                                                        setIcon(iconName)
                                                    }
                                                    className={cn(
                                                        "flex items-center justify-center p-1.5",
                                                        selected && "bg-accent",
                                                    )}
                                                >
                                                    <Icon className="size-4" />
                                                </DropdownMenuItem>
                                            );
                                        },
                                    )}
                                </div>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name.trim() || saving}>
                            {saving && (
                                <Loader2 className="size-4 animate-spin" />
                            )}
                            {editing ? "Save changes" : "Create directory"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
