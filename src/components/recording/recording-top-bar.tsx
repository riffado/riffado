"use client";

import {
    Check,
    ChevronLeft,
    Cpu,
    FileText,
    MoreHorizontal,
    Pencil,
    RefreshCw,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import { useRef } from "react";
import { DownloadAudioButton } from "@/components/recordings/download-audio-button";
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
import { StatusLine } from "@/components/ui/status-dot";
import type { SummaryPromptOption } from "@/hooks/use-transcription-summary";
import { cn } from "@/lib/utils";

interface Props {
    recordingId: string;
    title: string;
    origin: string | null;
    back?: { label: string; onBack: () => void; showOnDesktop?: boolean };
    hasTranscript: boolean;
    hasSummary: boolean;
    isTranscribing: boolean;
    browserBusy: boolean;
    isSummarizing: boolean;
    summaryPreset: string;
    summaryPresets: SummaryPromptOption[];
    onRename: () => void;
    onTranscribe: () => void;
    onTranscribeInBrowser: () => void;
    onSummarize: (preset: string) => void;
    onDeleteSummary: () => void;
    onDelete: () => void;
}

/**
 * Recording top bar: small title (or a back link on phones), where the
 * transcript came from, download, and a More menu with every other
 * recording action.
 */
export function RecordingTopBar({
    recordingId,
    title,
    origin,
    back,
    hasTranscript,
    hasSummary,
    isTranscribing,
    browserBusy,
    isSummarizing,
    summaryPreset,
    summaryPresets,
    onRename,
    onTranscribe,
    onTranscribeInBrowser,
    onSummarize,
    onDeleteSummary,
    onDelete,
}: Props) {
    // Rename starts once the menu has closed, so the menu's focus
    // handling can't pull focus back out of the title field.
    const renameOnCloseRef = useRef(false);
    const transcribeBusy = isTranscribing || browserBusy;

    return (
        <div className="flex h-13 shrink-0 items-center justify-between gap-4 px-2 lg:h-16 lg:pr-6 lg:pl-10">
            <div className="flex min-w-0 items-center gap-1">
                {back ? (
                    <button
                        type="button"
                        onClick={back.onBack}
                        className={cn(
                            "flex h-11 shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] pr-2.5 pl-1 text-base font-medium text-strong outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-8 lg:text-ui",
                            !back.showOnDesktop && "lg:hidden",
                            back.showOnDesktop && "lg:-ml-3",
                        )}
                    >
                        <ChevronLeft
                            className="size-5.5 lg:size-4.5"
                            strokeWidth={1.9}
                        />
                        {back.label}
                    </button>
                ) : null}
                <p
                    className={cn(
                        "truncate text-ui font-medium text-strong max-lg:hidden",
                        back?.showOnDesktop && "lg:pl-2",
                    )}
                >
                    {title}
                </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {origin ? (
                    <StatusLine
                        tone="ready"
                        className="mr-1 text-small text-subtle max-lg:hidden"
                    >
                        {origin}
                    </StatusLine>
                ) : null}
                <div className="flex items-center gap-0.5">
                    <DownloadAudioButton
                        recordingId={recordingId}
                        className="max-lg:size-11 max-lg:rounded-[var(--radius-control)]"
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="More actions"
                                className="max-lg:size-11 max-lg:rounded-[var(--radius-control)]"
                            >
                                <MoreHorizontal className="size-4.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="min-w-52"
                            onCloseAutoFocus={(e) => {
                                if (renameOnCloseRef.current) {
                                    e.preventDefault();
                                    renameOnCloseRef.current = false;
                                    onRename();
                                }
                            }}
                        >
                            <DropdownMenuItem
                                onSelect={() => {
                                    renameOnCloseRef.current = true;
                                }}
                            >
                                <Pencil />
                                Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                disabled={transcribeBusy}
                                onSelect={onTranscribe}
                            >
                                {hasTranscript ? <RefreshCw /> : <FileText />}
                                {hasTranscript ? "Re-transcribe" : "Transcribe"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={transcribeBusy}
                                onSelect={onTranscribeInBrowser}
                            >
                                <Cpu />
                                Transcribe in browser
                            </DropdownMenuItem>
                            {hasTranscript ? (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger
                                        disabled={isSummarizing}
                                        className="[&_svg]:size-4"
                                    >
                                        <Sparkles />
                                        {hasSummary
                                            ? "Regenerate summary"
                                            : "Summarize"}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="min-w-48">
                                        {summaryPresets.map((preset) => (
                                            <DropdownMenuItem
                                                key={preset.id}
                                                onSelect={() =>
                                                    onSummarize(preset.id)
                                                }
                                            >
                                                <Check
                                                    className={cn(
                                                        preset.id !==
                                                            summaryPreset &&
                                                            "invisible",
                                                    )}
                                                />
                                                {preset.name}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            ) : null}
                            {hasSummary ? (
                                <DropdownMenuItem onSelect={onDeleteSummary}>
                                    <X />
                                    Delete summary
                                </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={(e) => {
                                    // Keep the menu mounted so the confirm
                                    // dialog can take focus.
                                    e.preventDefault();
                                    onDelete();
                                }}
                            >
                                <Trash2 />
                                Delete recording
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
}
