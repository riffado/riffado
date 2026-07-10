"use client";

import {
    Check,
    FolderInput,
    Loader2,
    MoreHorizontal,
    Play,
    Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format-date";
import { formatDurationMs } from "@/lib/format-duration";
import { getFiletagIcon } from "@/lib/plaud/filetag-icons";
import { cn } from "@/lib/utils";
import type { DateTimeFormat } from "@/types/common";
import type { Filetag } from "@/types/filetag";
import type { Recording } from "@/types/recording";

export function RecordingRow({
    recording,
    isSelected,
    inFlight,
    snippet,
    isCompact,
    rowPadding,
    dateTimeFormat,
    filetags,
    onSelect,
    onDelete,
    onMoveToFiletag,
    registerRef,
}: {
    recording: Recording;
    isSelected: boolean;
    inFlight: "transcribing" | "summarizing" | undefined;
    snippet: string | null;
    isCompact: boolean;
    rowPadding: string;
    dateTimeFormat: DateTimeFormat;
    filetags: Filetag[];
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    onMoveToFiletag: (
        recording: Recording,
        filetagId: string | null,
    ) => Promise<void>;
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
    const confirm = useConfirm();
    const currentTag = recording.filetagId
        ? filetags.find((tag) => tag.id === recording.filetagId)
        : undefined;
    const CurrentTagIcon = currentTag ? getFiletagIcon(currentTag.icon) : null;
    return (
        <div
            className={cn(
                "group/row relative",
                isSelected
                    ? "bg-accent shadow-[inset_2px_0_0_0_var(--color-primary)]"
                    : null,
            )}
        >
            <button
                ref={(el) => {
                    registerRef(recording.id, el);
                }}
                type="button"
                onClick={() => onSelect(recording)}
                className={cn(
                    "w-full text-left transition-colors hover:bg-accent/60",
                    rowPadding,
                )}
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {currentTag && CurrentTagIcon && (
                            <CurrentTagIcon
                                aria-label={`Directory: ${currentTag.name}`}
                                className="size-3.5 shrink-0"
                                style={{ color: currentTag.color }}
                            />
                        )}
                        <h3 className="truncate text-sm font-medium">
                            {recording.filename}
                        </h3>
                        {inFlight && (
                            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
                                <Loader2
                                    className="size-3 animate-spin"
                                    aria-hidden="true"
                                />
                                {inFlight === "transcribing"
                                    ? "Transcribing"
                                    : "Summarizing"}
                            </span>
                        )}
                    </div>
                    {snippet ? (
                        <p
                            className={cn(
                                "truncate text-xs text-muted-foreground",
                                isCompact ? "mt-0.5" : "mt-1",
                            )}
                        >
                            {snippet}
                        </p>
                    ) : (
                        <p
                            className={cn(
                                "text-xs text-muted-foreground",
                                isCompact ? "mt-0.5" : "mt-1",
                            )}
                        >
                            {formatDurationMs(recording.duration)}
                            {" · "}
                            {formatDateTime(
                                recording.startTime,
                                dateTimeFormat,
                            )}
                        </p>
                    )}
                </div>
            </button>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Row actions"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onSelect(recording)}>
                            <Play />
                            Open
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <FolderInput className="mr-2 size-4 text-muted-foreground" />
                                Move to directory
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                {filetags.map((tag) => {
                                    const Icon = getFiletagIcon(tag.icon);
                                    return (
                                        <DropdownMenuItem
                                            key={tag.id}
                                            onSelect={() =>
                                                void onMoveToFiletag(
                                                    recording,
                                                    tag.id,
                                                )
                                            }
                                        >
                                            <Icon
                                                style={{ color: tag.color }}
                                            />
                                            <span className="truncate">
                                                {tag.name}
                                            </span>
                                            {recording.filetagId === tag.id && (
                                                <Check className="ml-auto" />
                                            )}
                                        </DropdownMenuItem>
                                    );
                                })}
                                {filetags.length > 0 && (
                                    <DropdownMenuSeparator />
                                )}
                                <DropdownMenuItem
                                    onSelect={() =>
                                        void onMoveToFiletag(recording, null)
                                    }
                                    disabled={recording.filetagId === null}
                                >
                                    No directory
                                    {recording.filetagId === null && (
                                        <Check className="ml-auto" />
                                    )}
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={(e) => {
                                // Keep menu mounted so confirm dialog can take focus.
                                e.preventDefault();
                                void confirm({
                                    title: "Delete this recording?",
                                    description: (
                                        <>
                                            <span className="font-medium text-foreground">
                                                {recording.filename}
                                            </span>
                                            <br />
                                            The audio file and any transcript or
                                            summary will be removed. If the file
                                            is still on your Plaud device, the
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
                            <Trash2 />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
