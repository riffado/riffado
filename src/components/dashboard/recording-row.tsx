"use client";

import { Loader2, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
    const confirm = useConfirm();

    return (
        <div
            className={cn(
                "group/row relative transition-colors duration-100",
                isSelected
                    ? "bg-primary/8 dark:bg-primary/10 shadow-[inset_2px_0_0_0_var(--color-primary)]"
                    : "hover:bg-accent/40 dark:hover:bg-accent/50",
            )}
        >
            <button
                ref={(el) => registerRef(recording.id, el)}
                type="button"
                onClick={() => onSelect(recording)}
                className={cn(
                    "w-full text-left pr-10",
                    rowPadding,
                )}
            >
                <div className="min-w-0 flex-1 space-y-0.5">
                    {/* Filename + status */}
                    <div className="flex items-center gap-2">
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

                        {inFlight && (
                            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                <Loader2 className="size-2.5 animate-spin" aria-hidden />
                                {inFlight === "transcribing" ? "Transcribing" : "Summarizing"}
                            </span>
                        )}
                    </div>

                    {/* Metadata / snippet */}
                    {snippet ? (
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
                            <span>{formatDurationMs(recording.duration)}</span>
                            <span className="mx-1 opacity-40">·</span>
                            <span>{formatDateTime(recording.startTime, dateTimeFormat)}</span>
                        </p>
                    )}
                </div>
            </button>

            {/* Row actions — appear on hover / focus */}
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
                        <DropdownMenuItem onSelect={() => onSelect(recording)}>
                            <Play className="size-3.5" />
                            Open
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
                                            The audio file and any transcript or summary will be
                                            removed. If the file is still on your Plaud device, the
                                            next sync will re-download it.
                                        </>
                                    ),
                                    confirmLabel: "Delete",
                                    pendingLabel: "Deleting…",
                                    destructive: true,
                                    onConfirm: () => onDelete(recording),
                                });
                            }}
                        >
                            <Trash2 className="size-3.5" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
