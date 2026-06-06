"use client";

import {
    Archive,
    Check,
    Loader2,
    MoreHorizontal,
    Pencil,
    Play,
    Trash2,
    X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import {
    BottomSheet,
    BottomSheetAction,
    BottomSheetContent,
    BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/use-long-press";
import { formatDateTime } from "@/lib/format-date";
import { formatDurationMs } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import type { DateTimeFormat } from "@/types/common";
import type { Recording } from "@/types/recording";

export function RecordingRow({
    recording,
    isSelected,
    inFlight,
    snippet,
    isCompact,
    rowPadding,
    dateTimeFormat,
    onSelect,
    onDelete,
    onArchive,
    onTitleChange,
    registerRef,
}: {
    recording: Recording;
    isSelected: boolean;
    inFlight: "transcribing" | "summarizing" | undefined;
    snippet: string | null;
    isCompact: boolean;
    rowPadding: string;
    dateTimeFormat: DateTimeFormat;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    onArchive: (recording: Recording) => Promise<void>;
    onTitleChange: (recording: Recording, newTitle: string) => void;
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
    const confirm = useConfirm();

    // ── Inline title editing ─────────────────────────────────────
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback(
        (e?: React.MouseEvent | Event) => {
            e?.stopPropagation();
            setEditValue(recording.filename);
            setEditing(true);
            setTimeout(() => {
                inputRef.current?.select();
            }, 30);
        },
        [recording.filename],
    );

    const cancelEdit = useCallback(() => {
        setEditing(false);
        setEditValue("");
    }, []);

    const commitEdit = useCallback(async () => {
        const trimmed = editValue.trim();
        if (!trimmed || trimmed === recording.filename) {
            cancelEdit();
            return;
        }
        setIsSavingTitle(true);
        try {
            const res = await fetch(`/api/recordings/${recording.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: trimmed }),
            });
            if (!res.ok) throw new Error("Failed to save");
            onTitleChange(recording, trimmed);
            setEditing(false);
        } catch {
            toast.error("Couldn't save title — please try again.");
        } finally {
            setIsSavingTitle(false);
        }
    }, [editValue, recording, cancelEdit, onTitleChange]);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void commitEdit();
            } else if (e.key === "Escape") {
                cancelEdit();
            }
        },
        [commitEdit, cancelEdit],
    );

    // ── Mobile long-press context sheet ─────────────────────────
    const [sheetOpen, setSheetOpen] = useState(false);

    const longPressHandlers = useLongPress({
        onLongPress: () => setSheetOpen(true),
    });

    const handleSheetOpen = (recording: Recording) => {
        setSheetOpen(false);
        onSelect(recording);
    };

    const handleSheetArchive = async () => {
        setSheetOpen(false);
        await onArchive(recording);
    };

    const handleSheetDelete = () => {
        setSheetOpen(false);
        void confirm({
            title: "Delete this recording?",
            description: (
                <>
                    <span className="font-medium text-foreground">
                        {recording.filename}
                    </span>
                    <br />
                    The audio file and any transcript or summary will be
                    removed.
                </>
            ),
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: () => onDelete(recording),
        });
    };

    return (
        <>
            <div
                className={cn(
                    "group/row relative transition-colors duration-100",
                    isSelected
                        ? "bg-primary/8 dark:bg-primary/10 shadow-[inset_2px_0_0_0_var(--color-primary)]"
                        : "hover:bg-accent/40 dark:hover:bg-accent/50",
                )}
                {...longPressHandlers}
            >
                <button
                    ref={(el) => registerRef(recording.id, el)}
                    type="button"
                    onClick={() => {
                        if (!editing) onSelect(recording);
                    }}
                    className={cn("w-full text-left pr-10", rowPadding)}
                >
                    <div className="min-w-0 flex-1 space-y-0.5">
                        {/* Filename + status */}
                        <div className="flex items-center gap-2">
                            {editing ? (
                                /* biome-ignore lint/a11y/noStaticElementInteractions: propagation-stop wrapper around a keyboard-accessible <input>; keyboard interaction is handled by the input itself */
                                <div
                                    role="presentation"
                                    className="flex flex-1 items-center gap-1.5 min-w-0"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                >
                                    <input
                                        ref={inputRef}
                                        value={editValue}
                                        onChange={(e) =>
                                            setEditValue(e.target.value)
                                        }
                                        onKeyDown={onKeyDown}
                                        onBlur={() => void commitEdit()}
                                        disabled={isSavingTitle}
                                        className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-sm font-medium outline-none ring-1 ring-primary/30 focus:ring-primary"
                                        autoComplete="off"
                                    />
                                    {isSavingTitle ? (
                                        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    void commitEdit();
                                                }}
                                                className="shrink-0 text-primary hover:text-primary/80"
                                            >
                                                <Check className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    cancelEdit();
                                                }}
                                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                            >
                                                <X className="size-3.5" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <h3
                                    className={cn(
                                        "truncate text-sm leading-snug",
                                        isSelected
                                            ? "font-semibold text-foreground"
                                            : "font-medium text-foreground/90",
                                    )}
                                >
                                    {recording.filename}
                                </h3>
                            )}

                            {!editing && inFlight && (
                                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                    <Loader2
                                        className="size-2.5 animate-spin"
                                        aria-hidden
                                    />
                                    {inFlight === "transcribing"
                                        ? "Transcribing"
                                        : "Summarizing"}
                                </span>
                            )}
                        </div>

                        {/* Metadata / snippet */}
                        {!editing &&
                            (snippet ? (
                                <p
                                    className={cn(
                                        "truncate text-xs leading-relaxed text-muted-foreground",
                                        isCompact ? "mt-0" : "mt-0.5",
                                    )}
                                >
                                    {snippet}
                                </p>
                            ) : (
                                <p className="text-xs text-muted-foreground/70 tabular-nums">
                                    <span>
                                        {formatDurationMs(recording.duration)}
                                    </span>
                                    <span className="mx-1 opacity-40">·</span>
                                    <span>
                                        {formatDateTime(
                                            recording.startTime,
                                            dateTimeFormat,
                                        )}
                                    </span>
                                </p>
                            ))}
                    </div>
                </button>

                {/* Row actions — appear on hover / focus (desktop) */}
                {!editing && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Row actions"
                                    onClick={(e) => e.stopPropagation()}
                                    className="size-7 rounded-md text-muted-foreground hover:text-foreground"
                                >
                                    <MoreHorizontal className="size-3.5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                    onSelect={() => onSelect(recording)}
                                >
                                    <Play className="size-3.5" />
                                    Open
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={startEdit}>
                                    <Pencil className="size-3.5" />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onSelect={() => void onArchive(recording)}
                                >
                                    <Archive className="size-3.5" />
                                    Archive
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={(e) => {
                                        e.preventDefault();
                                        void confirm({
                                            title: "Delete this recording?",
                                            description: (
                                                <>
                                                    <span className="font-medium text-foreground">
                                                        {recording.filename}
                                                    </span>
                                                    <br />
                                                    The audio file and any
                                                    transcript or summary will
                                                    be removed. If the file is
                                                    still on your Plaud device,
                                                    the next sync will
                                                    re-download it.
                                                </>
                                            ),
                                            confirmLabel: "Delete",
                                            pendingLabel: "Deleting…",
                                            destructive: true,
                                            onConfirm: () =>
                                                onDelete(recording),
                                        });
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            {/* Mobile long-press bottom sheet */}
            <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <BottomSheetContent
                    title={recording.filename}
                    className="max-w-lg mx-auto"
                >
                    <div className="pb-6">
                        <BottomSheetAction
                            onClick={() => handleSheetOpen(recording)}
                        >
                            <Play className="size-4 text-muted-foreground" />
                            Open
                        </BottomSheetAction>
                        <BottomSheetAction onClick={startEdit}>
                            <Pencil className="size-4 text-muted-foreground" />
                            Rename
                        </BottomSheetAction>
                        <BottomSheetSeparator />
                        <BottomSheetAction
                            onClick={() => void handleSheetArchive()}
                        >
                            <Archive className="size-4 text-muted-foreground" />
                            Archive
                        </BottomSheetAction>
                        <BottomSheetSeparator />
                        <BottomSheetAction
                            variant="destructive"
                            onClick={handleSheetDelete}
                        >
                            <Trash2 className="size-4" />
                            Delete
                        </BottomSheetAction>
                    </div>
                </BottomSheetContent>
            </BottomSheet>
        </>
    );
}
