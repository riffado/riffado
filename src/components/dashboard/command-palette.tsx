"use client";

import { Command, defaultFilter } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ActionsGroup,
    PaletteFooter,
    RECORDING_CAP,
    RecordingsGroup,
    recordingItemValue,
    ThemeGroup,
} from "@/components/dashboard/command-palette-parts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { DateTimeFormat } from "@/lib/format-date";
import { filterRecordingsByQuery } from "@/lib/recordings/search";
import type { Recording } from "@/types/recording";
import "@/components/dashboard/command-palette.css";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    currentTheme: "light" | "dark" | "system";
    dateTimeFormat: DateTimeFormat;
    onSelectRecording: (r: Recording) => void;
    /** Omitted when there is no Plaud connection; hides the Sync action. */
    onSync?: () => void;
    onUpload: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
    onSetTheme: (t: "light" | "dark" | "system") => void;
    /** Omitted when no transcription provider is set up; hides Transcribe. */
    onTranscribeRecording?: (id: string) => void;
}

export function CommandPalette({
    open,
    onOpenChange,
    recordings,
    transcriptions,
    currentRecording,
    inFlightActions,
    currentTheme,
    dateTimeFormat,
    onSelectRecording,
    onSync,
    onUpload,
    onOpenSettings,
    onOpenShortcuts,
    onSetTheme,
    onTranscribeRecording,
}: CommandPaletteProps) {
    // Wrap action handlers so the palette closes first, then the
    // action runs on the next tick. Without the defer, dialogs the
    // action opens (settings, shortcuts) race the palette's own
    // close transition and end up stacked or fail to mount.
    const runAction = (fn: () => void) => () => {
        onOpenChange(false);
        setTimeout(fn, 0);
    };

    // Filtering is ours, not cmdk's: recordings match exactly like the
    // library search (title and full transcript), and actions keep
    // cmdk's fuzzy match on their labels.
    const [search, setSearch] = useState("");
    useEffect(() => {
        if (!open) setSearch("");
    }, [open]);
    const matchingRecordings = useMemo(
        () => filterRecordingsByQuery(recordings, transcriptions, search),
        [recordings, transcriptions, search],
    );
    const visibleRecordings = matchingRecordings.slice(0, RECORDING_CAP);
    const matchesLabel = (label: string) =>
        !search.trim() || defaultFilter(label, search.trim()) > 0;

    // Controlled `value` on the cmdk root lets us look up the
    // currently-highlighted item when the user fires a global
    // keyboard shortcut like ⌘↵. Without controlling it, cmdk owns
    // the value internally and there's no way to peek at it from a
    // keydown handler.
    const [activeValue, setActiveValue] = useState("");

    // Lookup from a row's cmdk `value` to its recording id, for rows
    // that can be transcribed (no transcript, nothing in flight). The
    // highlighted row shows its Transcribe chip and answers ⌘↵ only
    // when it is in this map.
    const transcribeTargets = useMemo(() => {
        const map = new Map<string, string>();
        if (!onTranscribeRecording) return map;
        for (const r of visibleRecordings) {
            if (r.hasTranscript) continue;
            if (inFlightActions.get(r.id) === "transcribing") continue;
            map.set(recordingItemValue(r.id), r.id);
        }
        return map;
    }, [visibleRecordings, inFlightActions, onTranscribeRecording]);

    // Stable ref to the latest map + handler so the keydown listener
    // doesn't have to be re-created (or get stale) on every render.
    const transcribeTargetsRef = useRef(transcribeTargets);
    transcribeTargetsRef.current = transcribeTargets;
    const onTranscribeRef = useRef(onTranscribeRecording);
    onTranscribeRef.current = onTranscribeRecording;

    const handleKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // ⌘↵ / Ctrl+↵ — secondary action on the highlighted row.
        // Captured before cmdk processes Enter so the regular Enter
        // path (open recording) stays untouched. The palette stays
        // open so the user can trigger more quick actions in
        // succession without re-opening; the row's status flips to
        // "Transcribing" the moment markAction lands.
        if (e.key !== "Enter" || (!e.metaKey && !e.ctrlKey)) return;
        const id = transcribeTargetsRef.current.get(activeValue);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        onTranscribeRef.current?.(id);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                instant
                aria-describedby={undefined}
                className="squircle top-24 translate-y-0 gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-160"
                showCloseButton={false}
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>
                <Command
                    className="command-palette"
                    label="Command palette"
                    shouldFilter={false}
                    value={activeValue}
                    onValueChange={setActiveValue}
                    onKeyDownCapture={handleKeyDownCapture}
                >
                    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
                        <Search
                            className="size-4.5 shrink-0 text-subtle"
                            aria-hidden="true"
                        />
                        <Command.Input
                            value={search}
                            onValueChange={setSearch}
                            placeholder="Search recordings, transcripts and actions"
                            className="min-w-0 flex-1 bg-transparent text-base leading-5.5 text-strong outline-none placeholder:text-muted-foreground"
                        />
                    </div>

                    <Command.List className="max-h-[min(60vh,560px)] overflow-y-auto px-2 pt-1 pb-2">
                        <Command.Empty>
                            No matches.
                            <div className="cmd-empty-hint">
                                Try searching by something you talked about.
                            </div>
                        </Command.Empty>

                        <RecordingsGroup
                            recordings={visibleRecordings}
                            totalCount={matchingRecordings.length}
                            heading={search.trim() ? "Recordings" : "Recent"}
                            transcriptions={transcriptions}
                            currentRecording={currentRecording}
                            inFlightActions={inFlightActions}
                            dateTimeFormat={dateTimeFormat}
                            activeValue={activeValue}
                            onSelectRecording={onSelectRecording}
                            onTranscribeRecording={onTranscribeRecording}
                            runAction={runAction}
                        />

                        <ActionsGroup
                            onSync={onSync}
                            onUpload={onUpload}
                            onOpenSettings={onOpenSettings}
                            onOpenShortcuts={onOpenShortcuts}
                            matches={matchesLabel}
                            runAction={runAction}
                        />

                        <ThemeGroup
                            currentTheme={currentTheme}
                            onSetTheme={onSetTheme}
                            matches={matchesLabel}
                            runAction={runAction}
                        />
                    </Command.List>

                    <PaletteFooter
                        showTranscribeHint={transcribeTargets.has(activeValue)}
                    />
                </Command>
            </DialogContent>
        </Dialog>
    );
}
