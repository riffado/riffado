"use client";

import {
    Check,
    FolderInput,
    Loader2,
    MoreHorizontal,
    Play,
    Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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
    const lineRef = useRef<HTMLParagraphElement>(null);
    const metaRef = useRef<HTMLSpanElement>(null);
    const chipMeasureRef = useRef<HTMLSpanElement>(null);
    const [showTagName, setShowTagName] = useState(false);
    // Show the directory name in the chip only when the full chip fits next
    // to the untruncated metadata text; otherwise fall back to icon only.
    useLayoutEffect(() => {
        const line = lineRef.current;
        const meta = metaRef.current;
        const measure = chipMeasureRef.current;
        if (!line || !meta || !measure) {
            setShowTagName(false);
            return;
        }
        const update = () => {
            const gap =
                Number.parseFloat(getComputedStyle(line).columnGap) || 0;
            setShowTagName(
                meta.scrollWidth + gap + measure.offsetWidth <=
                    line.clientWidth,
            );
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(line);
        return () => observer.disconnect();
    });
    const filetagChip =
        currentTag && CurrentTagIcon ? (
            <span
                role="img"
                aria-label={`Directory: ${currentTag.name}`}
                title={currentTag.name}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5"
                style={{
                    backgroundColor: `color-mix(in srgb, ${currentTag.color} 15%, transparent)`,
                }}
            >
                <CurrentTagIcon
                    className="size-3 shrink-0"
                    style={{ color: currentTag.color }}
                />
                {showTagName && (
                    <span
                        className="whitespace-nowrap text-[11px]"
                        style={{ color: currentTag.color }}
                    >
                        {currentTag.name}
                    </span>
                )}
            </span>
        ) : null;
    // Invisible copy of the full chip (icon + name), out of layout flow, used
    // to measure how wide the chip would be if the name were shown.
    const filetagChipMeasurer =
        currentTag && CurrentTagIcon ? (
            <span
                ref={chipMeasureRef}
                aria-hidden="true"
                className="pointer-events-none invisible absolute left-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
            >
                <CurrentTagIcon className="size-3 shrink-0" />
                <span className="whitespace-nowrap text-[11px]">
                    {currentTag.name}
                </span>
            </span>
        ) : null;
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
                    <p
                        ref={lineRef}
                        className={cn(
                            "relative flex items-center gap-1.5 text-xs text-muted-foreground",
                            isCompact ? "mt-0.5" : "mt-1",
                        )}
                    >
                        <span ref={metaRef} className="min-w-0 truncate">
                            {snippet ?? (
                                <>
                                    {formatDurationMs(recording.duration)}
                                    {" · "}
                                    {formatDateTime(
                                        recording.startTime,
                                        dateTimeFormat,
                                    )}
                                </>
                            )}
                        </span>
                        {filetagChip}
                        {filetagChipMeasurer}
                    </p>
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
                                    // Plaud-backed recordings can't live in
                                    // local-only directories (the API rejects
                                    // the move with 409), so disable those
                                    // targets instead of offering a dead end.
                                    const incompatible =
                                        tag.isLocalOnly &&
                                        !recording.isLocalOnly;
                                    return (
                                        <DropdownMenuItem
                                            key={tag.id}
                                            disabled={incompatible}
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
                                            {incompatible && (
                                                <span className="ml-auto text-xs text-muted-foreground">
                                                    local
                                                </span>
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
