"use client";

import { Download, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { formatDurationMs } from "@/lib/format-duration";
import { recordingAudioDownloadPath } from "@/lib/recordings/filename";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

/** Where a row's status dot stands: in flight, transcribed, or not yet. */
export function recordingRowTone(
    hasTranscript: boolean,
    inFlight: "transcribing" | "summarizing" | undefined,
): StatusTone {
    if (inFlight) return "working";
    return hasTranscript ? "ready" : "idle";
}

/**
 * Shared geometry for list rows (recordings and pending uploads): a fixed
 * 8px status-dot lane, then title + duration, a one-line detail, and a
 * metadata line.
 */
export function RecordingRowLayout({
    tone,
    title,
    duration,
    detail,
    meta,
    isCompact,
}: {
    tone: StatusTone;
    title: string;
    duration?: string;
    detail?: string | null;
    meta?: string | null;
    isCompact: boolean;
}) {
    return (
        <div className={cn("flex gap-3 px-3.5", isCompact ? "py-2" : "py-3")}>
            <div className="flex w-2 shrink-0 pt-1.75">
                <StatusDot tone={tone} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.75">
                <div className="flex justify-between gap-3">
                    <span className="truncate text-ui font-semibold text-strong">
                        {title}
                    </span>
                    {duration ? (
                        <span className="shrink-0 text-xs text-subtle tabular-nums">
                            {duration}
                        </span>
                    ) : null}
                </div>
                {detail ? (
                    <p className="truncate text-small text-subtle">{detail}</p>
                ) : null}
                {meta ? (
                    <p className="truncate text-xs text-muted-foreground">
                        {meta}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

export function RecordingRow({
    recording,
    isSelected,
    hasTranscript,
    inFlight,
    snippet,
    meta,
    isCompact,
    onSelect,
    onDelete,
    registerRef,
}: {
    recording: Recording;
    isSelected: boolean;
    hasTranscript: boolean;
    inFlight: "transcribing" | "summarizing" | undefined;
    snippet: string | null;
    meta: string | null;
    isCompact: boolean;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
    const confirm = useConfirm();
    const detail = inFlight
        ? inFlight === "transcribing"
            ? "Transcribing…"
            : "Summarizing…"
        : hasTranscript
          ? snippet
          : "Not transcribed yet";

    return (
        <div className="group/row relative">
            <button
                ref={(el) => {
                    registerRef(recording.id, el);
                }}
                type="button"
                onClick={() => onSelect(recording)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                    "squircle block w-full scroll-mt-10 rounded-[var(--radius-item)] text-left outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isSelected ? "bg-accent" : "hover:bg-accent/60",
                )}
            >
                <RecordingRowLayout
                    tone={recordingRowTone(hasTranscript, inFlight)}
                    title={recording.filename}
                    duration={formatDurationMs(recording.duration)}
                    detail={detail}
                    meta={meta}
                    isCompact={isCompact}
                />
            </button>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            aria-label="Row actions"
                            className="bg-accent hover:bg-border"
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
                        <DropdownMenuItem
                            onSelect={() => {
                                window.location.assign(
                                    recordingAudioDownloadPath(recording.id),
                                );
                            }}
                        >
                            <Download />
                            Download audio
                        </DropdownMenuItem>
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
                                            The audio, transcript and summary
                                            are removed from Riffado. A copy in
                                            your Plaud account stays there and
                                            won't sync back.
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
