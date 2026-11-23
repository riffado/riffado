"use client";

import { MoreHorizontal } from "lucide-react";
import { useRef } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import type { BrowserTranscription } from "@/components/dashboard/transcribe-in-browser-button";
import {
    displayTitle,
    formatSpokenDuration,
} from "@/components/recording/format";
import {
    confirmDeleteRecording,
    type RecordingActionHandlers,
    RecordingActionsContent,
    type RecordingActionsState,
} from "@/components/recording/recording-actions";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
    DropdownMenu,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import type { SummaryPrompts } from "@/hooks/use-summary-prompts";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

/**
 * What library rows need to run the recording action list for any
 * recording, selected or not. Rename and the summary actions open the
 * recording first, since they happen in its title and Overview tab.
 */
export interface RecordingRowActions {
    browser: BrowserTranscription;
    summaryPrompts: SummaryPrompts;
    /** Recordings the reader is summarizing. */
    summarizingIds: ReadonlySet<string>;
    /** False when no transcription provider is set up: menus offer only browser transcription. */
    serverTranscription: boolean;
    onRename: (recording: Recording) => void;
    onTranscribe: (recording: Recording) => void;
    onSummarize: (recording: Recording, promptId: string) => void;
    onDeleteSummary: (recording: Recording) => void;
}

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
    href,
    isSelected,
    hasTranscript,
    inFlight: queued,
    snippet,
    meta,
    isCompact,
    onSelect,
    onDelete,
    actions,
    registerRef,
}: {
    recording: Recording;
    /** Address of this recording (`?r=<id>`), for opening it in a new tab. */
    href: string;
    isSelected: boolean;
    hasTranscript: boolean;
    /** Server transcription or summary queued for this recording. */
    inFlight: "transcribing" | "summarizing" | undefined;
    snippet: string | null;
    meta: string | null;
    isCompact: boolean;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    actions: RecordingRowActions;
    registerRef: (id: string, el: HTMLElement | null) => void;
}) {
    const confirm = useConfirm();
    const rowRef = useRef<HTMLAnchorElement | null>(null);
    const browserHere = actions.browser.runningId === recording.id;
    const summarizing = actions.summarizingIds.has(recording.id);
    const inFlight =
        queued ??
        (browserHere
            ? "transcribing"
            : summarizing
              ? "summarizing"
              : undefined);
    const detail = inFlight
        ? inFlight === "transcribing"
            ? "Transcribing…"
            : "Summarizing…"
        : hasTranscript
          ? snippet
          : "Not transcribed yet";

    const menu: RecordingActionsState & RecordingActionHandlers = {
        recordingId: recording.id,
        hasTranscript,
        hasSummary: recording.hasSummary === true,
        transcribing:
            queued === "transcribing"
                ? "server"
                : browserHere
                  ? "browser"
                  : null,
        browserAvailable: !actions.browser.isRunning,
        serverTranscription: actions.serverTranscription,
        isSummarizing: summarizing,
        summaryPrompts: actions.summaryPrompts.options,
        currentPromptId: actions.summaryPrompts.selectedId,
        onRename: () => actions.onRename(recording),
        onTranscribe: () => actions.onTranscribe(recording),
        onTranscribeInBrowser: () => void actions.browser.start(recording.id),
        onSummarize: (promptId) => actions.onSummarize(recording, promptId),
        onDeleteSummary: () => actions.onDeleteSummary(recording),
        onDelete: () =>
            void confirmDeleteRecording(confirm, recording, () =>
                onDelete(recording),
            ),
    };

    return (
        <div className="group/row relative" data-flip-key={recording.id}>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <a
                        ref={(el) => {
                            rowRef.current = el;
                            registerRef(recording.id, el);
                        }}
                        href={href}
                        draggable={false}
                        onClick={(e) => {
                            if (
                                e.metaKey ||
                                e.ctrlKey ||
                                e.shiftKey ||
                                e.altKey ||
                                e.button !== 0
                            ) {
                                return;
                            }
                            e.preventDefault();
                            onSelect(recording);
                        }}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                            "squircle relative block w-full scroll-mt-10 rounded-[var(--radius-item)] text-left outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            isSelected
                                ? "bg-accent before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-strong"
                                : "hover:bg-accent/50 data-[state=open]:bg-accent/50 group-has-[[data-slot=dropdown-menu-trigger][data-state=open]]/row:bg-accent/50",
                        )}
                    >
                        <RecordingRowLayout
                            tone={recordingRowTone(hasTranscript, inFlight)}
                            title={displayTitle(recording.filename)}
                            duration={formatSpokenDuration(recording.duration)}
                            detail={detail}
                            meta={meta}
                            isCompact={isCompact}
                        />
                    </a>
                </ContextMenuTrigger>
                <RecordingActionsContent
                    flavour="context"
                    returnFocusTo={rowRef}
                    {...menu}
                />
            </ContextMenu>
            <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:block">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            aria-label={`Actions for ${displayTitle(recording.filename)}`}
                            className="bg-accent hover:bg-border"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <RecordingActionsContent
                        flavour="dropdown"
                        align="end"
                        {...menu}
                    />
                </DropdownMenu>
            </div>
        </div>
    );
}
