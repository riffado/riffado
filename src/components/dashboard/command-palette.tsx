"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
    ActionsGroup,
    Kbd,
    PaletteFooter,
    RECORDING_CAP,
    RecordingsGroup,
    ThemeGroup,
    transcriptSnippet,
} from "@/components/dashboard/command-palette-parts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { DateTimeFormat } from "@/lib/format-date";
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
    onSync: () => void;
    onUpload: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
    onSetTheme: (t: "light" | "dark" | "system") => void;
    onTranscribeRecording: (id: string) => void;
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

    const visibleRecordings = recordings.slice(0, RECORDING_CAP);

    // Controlled `value` on the cmdk root lets us look up the
    // currently-highlighted item when the user fires a global
    // keyboard shortcut like ⌘↵. Without controlling it, cmdk owns
    // the value internally and there's no way to peek at it from a
    // keydown handler.
    const [activeValue, setActiveValue] = useState("");

    // Build a lookup from a row's cmdk `value` string to its
    // recording id. The Transcribe quick action only applies to
    // recordings without a transcript, so the map deliberately
    // skips rows that wouldn't render the button — keying off this
    // map is both the "is this row a recording" check and the
    // "does it have a transcribe action" check.
    const transcribeTargets = useMemo(() => {
        const map = new Map<string, string>();
        for (const r of visibleRecordings) {
            if (r.hasTranscript) continue;
            if (inFlightActions.get(r.id) === "transcribing") continue;
            const snippet = transcriptSnippet(transcriptions.get(r.id)?.text);
            // Filter falsy parts before joining so the value doesn't
            // end in a trailing space when `snippet` is null. cmdk
            // trims values internally, so a trailing space would
            // make `activeValue` (trimmed) miss this map's key and
            // ⌘↵ / Ctrl+↵ would silently no-op.
            const value = [r.filename, r.id, snippet]
                .filter((p): p is string => Boolean(p))
                .join(" ");
            map.set(value, r.id);
        }
        return map;
    }, [visibleRecordings, inFlightActions, transcriptions]);

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
        onTranscribeRef.current(id);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-xl gap-0 overflow-hidden p-0"
                showCloseButton={false}
                aria-describedby={undefined}
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>
                <Command
                    className="command-palette"
                    label="Command palette"
                    value={activeValue}
                    onValueChange={setActiveValue}
                    onKeyDownCapture={handleKeyDownCapture}
                >
                    <div className="cmd-input-row">
                        <Search
                            className="cmd-input-icon size-4"
                            aria-hidden="true"
                        />
                        <Command.Input placeholder="Search recordings, transcripts, or actions…" />
                        <Kbd>⌘K</Kbd>
                    </div>

                    <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                        <Command.Empty>
                            No matches.
                            <div className="cmd-empty-hint">
                                Try searching by something you talked about.
                            </div>
                        </Command.Empty>

                        <RecordingsGroup
                            recordings={visibleRecordings}
                            transcriptions={transcriptions}
                            currentRecording={currentRecording}
                            inFlightActions={inFlightActions}
                            dateTimeFormat={dateTimeFormat}
                            onSelectRecording={onSelectRecording}
                            onTranscribeRecording={onTranscribeRecording}
                            runAction={runAction}
                        />

                        <ActionsGroup
                            onSync={onSync}
                            onUpload={onUpload}
                            onOpenSettings={onOpenSettings}
                            onOpenShortcuts={onOpenShortcuts}
                            runAction={runAction}
                        />

                        <ThemeGroup
                            currentTheme={currentTheme}
                            onSetTheme={onSetTheme}
                            runAction={runAction}
                        />
                    </Command.List>

                    <PaletteFooter
                        showTranscribeHint={transcribeTargets.size > 0}
                    />
                </Command>
            </DialogContent>
        </Dialog>
    );
}
