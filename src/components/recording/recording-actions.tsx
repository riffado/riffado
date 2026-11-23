"use client";

import {
    AudioLines,
    Check,
    Download,
    FileText,
    FileX,
    Monitor,
    Pencil,
    Trash2,
} from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import type { useConfirm } from "@/components/confirm-dialog";
import { displayTitle } from "@/components/recording/format";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { SummaryPromptOption } from "@/hooks/use-summary-prompts";
import { recordingAudioDownloadPath } from "@/lib/recordings/filename";
import type { Recording } from "@/types/recording";

/** Which Radix menu the actions render into. */
export type RecordingMenuFlavour = "dropdown" | "context";

/** What the action list needs to know about one recording. */
export interface RecordingActionsState {
    recordingId: string;
    hasTranscript: boolean;
    hasSummary: boolean;
    /** A transcription already running for this recording, if any. */
    transcribing: "server" | "browser" | null;
    /** False while a browser transcription runs for another recording. */
    browserAvailable: boolean;
    /**
     * False when nothing can transcribe on the server (no provider, no
     * Mynah): Transcribe and Re-transcribe are hidden. Defaults to true.
     */
    serverTranscription?: boolean;
    isSummarizing: boolean;
    /** Summary styles: presets first, then the user's own prompts. */
    summaryPrompts: SummaryPromptOption[];
    /** The style a plain Summarize uses; gets the check. */
    currentPromptId: string;
}

export interface RecordingActionHandlers {
    /** Runs after the menu has closed, so the title field keeps focus. */
    onRename: () => void;
    onTranscribe: () => void;
    onTranscribeInBrowser: () => void;
    onSummarize: (promptId: string) => void;
    onDeleteSummary: () => void;
    /**
     * Runs after the menu has closed and focus is back on its trigger,
     * so the confirm dialog takes focus and returns it there.
     */
    onDelete: () => void;
}

const PARTS = {
    dropdown: {
        Item: DropdownMenuItem,
        Separator: DropdownMenuSeparator,
        Sub: DropdownMenuSub,
        SubTrigger: DropdownMenuSubTrigger,
        SubContent: DropdownMenuSubContent,
    },
    context: {
        Item: ContextMenuItem,
        Separator: ContextMenuSeparator,
        Sub: ContextMenuSub,
        SubTrigger: ContextMenuSubTrigger,
        SubContent: ContextMenuSubContent,
    },
} as const;

type Pending = "rename" | "delete" | null;

/**
 * The recording action list (DESIGN.md "Menus (web)"), identical from the
 * recording's More button, a row's "…" button and a right-click on a row:
 *
 * Rename, Download audio | Transcribe or Re-transcribe, Transcribe in
 * browser | Summarize or Regenerate summary (styles submenu, own prompts
 * after a separator), Delete summary | Delete recording.
 *
 * Items that don't apply are hidden; an action already running shows
 * disabled with a "…" label. Renders the menu content too, because
 * Rename and Delete wait for the menu to close before they move focus.
 */
export function RecordingActionsContent({
    flavour,
    align,
    returnFocusTo,
    ...props
}: RecordingActionsState &
    RecordingActionHandlers & {
        flavour: RecordingMenuFlavour;
        /** Dropdown only: alignment against the trigger. */
        align?: "start" | "center" | "end";
        /**
         * Context menu only: element to focus once the menu closes (the
         * row), since a right-click has no trigger button to return to.
         */
        returnFocusTo?: React.RefObject<HTMLElement | null>;
    }) {
    const pending = useRef<Pending>(null);

    const handleCloseAutoFocus = (event: Event) => {
        const action = pending.current;
        pending.current = null;
        if (action === "rename") {
            event.preventDefault();
            props.onRename();
            return;
        }
        if (returnFocusTo?.current) {
            event.preventDefault();
            returnFocusTo.current.focus({ preventScroll: true });
        }
        // Radix focuses the trigger right after this handler returns;
        // open the dialog after that so it hands focus back there.
        if (action === "delete") queueMicrotask(props.onDelete);
    };

    const items = (
        <RecordingActionItems
            flavour={flavour}
            {...props}
            onRename={() => {
                pending.current = "rename";
            }}
            onDelete={() => {
                pending.current = "delete";
            }}
        />
    );

    return flavour === "dropdown" ? (
        <DropdownMenuContent
            align={align}
            className="min-w-59"
            onCloseAutoFocus={handleCloseAutoFocus}
        >
            {items}
        </DropdownMenuContent>
    ) : (
        <ContextMenuContent
            className="min-w-59"
            onCloseAutoFocus={handleCloseAutoFocus}
        >
            {items}
        </ContextMenuContent>
    );
}

/** The items alone, in order. Use inside `RecordingActionsContent`. */
function RecordingActionItems({
    flavour,
    recordingId,
    hasTranscript,
    hasSummary,
    transcribing,
    browserAvailable,
    serverTranscription = true,
    isSummarizing,
    summaryPrompts,
    currentPromptId,
    onRename,
    onTranscribe,
    onTranscribeInBrowser,
    onSummarize,
    onDeleteSummary,
    onDelete,
}: RecordingActionsState &
    RecordingActionHandlers & { flavour: RecordingMenuFlavour }) {
    const { Item, Separator, Sub, SubTrigger, SubContent } = PARTS[flavour];
    const presets = summaryPrompts.filter((p) => p.isPreset);
    const ownPrompts = summaryPrompts.filter((p) => !p.isPreset);
    const showSummaryGroup = hasTranscript || hasSummary;
    const showTranscribeGroup =
        transcribing !== null || serverTranscription || browserAvailable;

    const promptItem = (prompt: SummaryPromptOption) => (
        <Item key={prompt.id} onSelect={() => onSummarize(prompt.id)}>
            <span className="min-w-0 flex-1 truncate">{prompt.name}</span>
            {prompt.id === currentPromptId ? (
                <>
                    <Check className="text-strong" />
                    <span className="sr-only">(current style)</span>
                </>
            ) : null}
        </Item>
    );

    return (
        <>
            <Item onSelect={onRename}>
                <Pencil />
                Rename
            </Item>
            <Item asChild>
                <a
                    href={recordingAudioDownloadPath(recordingId)}
                    download
                    rel="nofollow noreferrer"
                >
                    <Download />
                    Download audio
                </a>
            </Item>

            {showTranscribeGroup ? <Separator /> : null}
            {transcribing === "server" ? (
                <Item disabled>
                    <AudioLines />
                    Transcribing…
                </Item>
            ) : transcribing === "browser" ? (
                <Item disabled>
                    <Monitor />
                    Transcribing in browser…
                </Item>
            ) : (
                <>
                    {serverTranscription ? (
                        <Item onSelect={onTranscribe}>
                            <AudioLines />
                            {hasTranscript ? "Re-transcribe" : "Transcribe"}
                        </Item>
                    ) : null}
                    {browserAvailable ? (
                        <Item onSelect={onTranscribeInBrowser}>
                            <Monitor />
                            Transcribe in browser
                        </Item>
                    ) : null}
                </>
            )}

            {showSummaryGroup ? <Separator /> : null}
            {hasTranscript && isSummarizing ? (
                <Item disabled>
                    <FileText />
                    Summarizing…
                </Item>
            ) : hasTranscript ? (
                <Sub>
                    <SubTrigger>
                        <FileText />
                        {hasSummary ? "Regenerate summary" : "Summarize"}
                    </SubTrigger>
                    <SubContent className="min-w-47">
                        {presets.map(promptItem)}
                        {ownPrompts.length > 0 ? <Separator /> : null}
                        {ownPrompts.map(promptItem)}
                    </SubContent>
                </Sub>
            ) : null}
            {hasSummary ? (
                <Item onSelect={onDeleteSummary}>
                    <FileX />
                    Delete summary
                </Item>
            ) : null}

            <Separator />
            <Item onSelect={onDelete}>
                <Trash2 />
                Delete recording
            </Item>
        </>
    );
}

/**
 * Asks before deleting a recording. The copy only claims what's true for
 * this recording: a transcript and summary when they exist, and a copy in
 * Plaud only for recordings that came from Plaud (not uploads).
 * `onDelete` throws to keep the dialog open.
 */
export function confirmDeleteRecording(
    confirm: ReturnType<typeof useConfirm>,
    recording: Pick<
        Recording,
        "filename" | "deviceSn" | "hasTranscript" | "hasSummary"
    >,
    onDelete: () => Promise<void>,
) {
    const extras =
        recording.hasTranscript && recording.hasSummary
            ? " and its transcript and summary are"
            : recording.hasTranscript
              ? " and its transcript are"
              : " is";
    const fromPlaud = recording.deviceSn !== "local";
    return confirm({
        title: "Delete this recording?",
        description: (
            <>
                <span className="font-medium text-strong">
                    {displayTitle(recording.filename)}
                </span>
                {extras} removed from Riffado.
                {fromPlaud
                    ? " A copy in your Plaud account stays there and won't sync back."
                    : " This can't be undone."}
            </>
        ),
        confirmLabel: "Delete recording",
        pendingLabel: "Deleting…",
        destructive: true,
        onConfirm: onDelete,
    });
}
