"use client";

import { Command } from "cmdk";
import {
    FileText,
    Keyboard,
    Loader2,
    Mic,
    Monitor,
    Moon,
    RefreshCw,
    Search,
    Settings,
    Sparkles,
    Sun,
    Upload,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { type DateTimeFormat, formatDateTime } from "@/lib/format-date";
import { formatDurationMs } from "@/lib/format-duration";
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

const RECORDING_CAP = 200;

/**
 * Strip transcript noise (timecodes, speaker labels, redundant
 * whitespace) into a single-line snippet usable as both a row
 * subtitle and a fuzzy-search target. Kept in sync with the helper
 * of the same name in `recording-list.tsx`; we duplicate rather
 * than import-cross because the list's helper is module-local
 * there and we don't want to widen its surface for one caller.
 */
function transcriptSnippet(
    text: string | undefined,
    maxChars = 140,
): string | null {
    if (!text) return null;
    const stripped = text
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) return null;
    if (stripped.length <= maxChars) return stripped;
    return `${stripped.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

/**
 * Generic two-line row used by every cmdk item in the palette so
 * icon weight, alignment, and accessory placement stay consistent
 * across groups (recordings, actions, theme).
 */
function Row({
    icon,
    title,
    subtitle,
    accessory,
}: {
    icon: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    accessory?: ReactNode;
}) {
    return (
        <>
            <span aria-hidden="true" className="shrink-0">
                {icon}
            </span>
            <span className="cmd-body">
                <span className="cmd-title">{title}</span>
                {subtitle ? (
                    <span className="cmd-subtitle">{subtitle}</span>
                ) : null}
            </span>
            {accessory ? (
                <span className="cmd-accessory">{accessory}</span>
            ) : null}
        </>
    );
}

function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="cmd-kbd">{children}</kbd>;
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
    const run = (fn: () => void) => () => {
        onOpenChange(false);
        setTimeout(fn, 0);
    };

    const visibleRecordings = recordings.slice(0, RECORDING_CAP);
    const overflowCount = Math.max(0, recordings.length - RECORDING_CAP);

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
            const value = [r.filename, r.id, snippet ?? ""].join(" ");
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
            >
                <DialogTitle className="sr-only">Command palette</DialogTitle>
                <Command
                    className="command-palette"
                    label="Command palette"
                    value={activeValue}
                    onValueChange={setActiveValue}
                    onKeyDownCapture={handleKeyDownCapture}
                >
                    {/* Input row */}
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

                        {/* Recordings */}
                        {visibleRecordings.length > 0 && (
                            <Command.Group heading="Recent">
                                {visibleRecordings.map((r) => {
                                    const snippet = transcriptSnippet(
                                        transcriptions.get(r.id)?.text,
                                    );
                                    const inFlight = inFlightActions.get(r.id);
                                    const isCurrent =
                                        currentRecording?.id === r.id;

                                    // Leading icon doubles as a state
                                    // indicator so the user can scan the
                                    // list and immediately tell which
                                    // recordings are audio-only, which
                                    // have a transcript, and which are
                                    // fully processed (transcript +
                                    // summary). In-flight wins because
                                    // it's the most actionable state
                                    // ("don't trigger this again").
                                    let stateIcon: ReactNode;
                                    let stateLabel: string;
                                    if (inFlight) {
                                        stateIcon = (
                                            <Loader2 className="size-4 animate-spin text-primary" />
                                        );
                                        stateLabel =
                                            inFlight === "transcribing"
                                                ? "Transcribing"
                                                : "Summarizing";
                                    } else if (!r.hasTranscript) {
                                        stateIcon = (
                                            <Mic className="size-4 text-muted-foreground" />
                                        );
                                        stateLabel = "Audio only";
                                    } else if (!r.hasSummary) {
                                        stateIcon = (
                                            <FileText className="size-4 text-foreground/70" />
                                        );
                                        stateLabel = "Transcribed";
                                    } else {
                                        stateIcon = (
                                            <Sparkles className="size-4 text-primary" />
                                        );
                                        stateLabel = "Transcribed & summarized";
                                    }

                                    // Subtitle mirrors the recording
                                    // list's second-line treatment so the
                                    // two surfaces feel like the same
                                    // app: transcript snippet when one
                                    // exists, else `duration · time` using
                                    // the user's selected date format.
                                    // The state (audio-only / transcribed
                                    // / processed) is conveyed by the
                                    // leading icon — no text duplication.
                                    const durationText = r.duration
                                        ? formatDurationMs(r.duration)
                                        : null;
                                    const timeText = formatDateTime(
                                        r.startTime,
                                        dateTimeFormat,
                                    );
                                    // Subtitle is rendered raw — the CSS shrink chain
                                    // (cmdk-item / .cmd-body / .cmd-subtitle, all with
                                    // `min-width: 0`) plus `text-overflow: ellipsis`
                                    // truncates to whatever the row can fit, regardless
                                    // of viewport width or string length.
                                    const subtitle: ReactNode = snippet
                                        ? snippet
                                        : durationText
                                          ? `${durationText} · ${timeText}`
                                          : timeText;

                                    // Search value bakes in transcript text
                                    // so cmdk's fuzzy matcher finds
                                    // recordings by their content, not just
                                    // their filename.
                                    const searchValue = [
                                        r.filename,
                                        r.id,
                                        snippet ?? "",
                                    ].join(" ");

                                    let accessory: ReactNode = null;
                                    if (inFlight === "transcribing") {
                                        accessory = (
                                            <span className="cmd-pill">
                                                <Loader2 className="size-3 animate-spin" />
                                                Transcribing
                                            </span>
                                        );
                                    } else if (inFlight === "summarizing") {
                                        accessory = (
                                            <span className="cmd-pill">
                                                <Loader2 className="size-3 animate-spin" />
                                                Summarizing
                                            </span>
                                        );
                                    } else if (!r.hasTranscript) {
                                        // Inline quick action: kicks off
                                        // transcription without changing
                                        // the current selection. The
                                        // `stopPropagation` calls on both
                                        // pointerdown and click are
                                        // intentional — cmdk treats a
                                        // pointerdown anywhere inside an
                                        // item as selection intent, which
                                        // would otherwise fire the row's
                                        // "open recording" handler in
                                        // addition to (or before) the
                                        // button's own onClick.
                                        // Quick action: fires the
                                        // transcribe request without
                                        // closing the palette. The user
                                        // typically wants to queue several
                                        // in a row; closing the palette
                                        // after each click would force a
                                        // ⌘K reopen between actions. The
                                        // row's accessory flips to a
                                        // "Transcribing" pill once
                                        // markAction lands, so the user
                                        // gets immediate feedback without
                                        // a visual mode switch.
                                        accessory = (
                                            <button
                                                type="button"
                                                className="cmd-row-action"
                                                onPointerDown={(e) =>
                                                    e.stopPropagation()
                                                }
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onTranscribeRecording(r.id);
                                                }}
                                                aria-label={`Transcribe ${r.filename}`}
                                            >
                                                <Sparkles
                                                    className="size-3"
                                                    aria-hidden="true"
                                                />
                                                Transcribe
                                            </button>
                                        );
                                    } else if (isCurrent) {
                                        // Lower priority than the
                                        // Transcribe quick-action: a
                                        // recording without a transcript
                                        // still benefits from the button
                                        // even when it happens to be the
                                        // currently selected row. cmdk's
                                        // own `data-selected` highlight
                                        // already conveys "this is the
                                        // active row" visually.
                                        accessory = (
                                            <span className="cmd-pill">
                                                <span
                                                    aria-hidden="true"
                                                    className="inline-block size-1.5 rounded-full bg-primary"
                                                />
                                                Selected
                                            </span>
                                        );
                                    }
                                    // No fallback accessory — the list's
                                    // "healthy rows are silent" convention
                                    // applies here too. Duration already
                                    // lives in the subtitle now, so a
                                    // duration accessory would duplicate.

                                    return (
                                        <Command.Item
                                            key={r.id}
                                            value={searchValue}
                                            onSelect={run(() =>
                                                onSelectRecording(r),
                                            )}
                                        >
                                            <Row
                                                /* Truncated for layout
                                                   safety; the full
                                                   filename is still in
                                                   `searchValue` so cmdk's
                                                   fuzzy matcher hits it. */
                                                icon={
                                                    // Icon is decorative;
                                                    // the state is also in
                                                    // the subtitle ("Audio
                                                    // only · …") so screen
                                                    // readers don't miss it.
                                                    // `title` gives sighted
                                                    // users a hover tooltip.
                                                    <span
                                                        title={stateLabel}
                                                        aria-hidden="true"
                                                    >
                                                        {stateIcon}
                                                    </span>
                                                }
                                                title={r.filename}
                                                subtitle={subtitle}
                                                accessory={accessory}
                                            />
                                        </Command.Item>
                                    );
                                })}
                                {overflowCount > 0 && (
                                    <div className="cmd-more-hint">
                                        +{overflowCount} more · refine your
                                        search to narrow the list
                                    </div>
                                )}
                            </Command.Group>
                        )}

                        {/* Actions */}
                        <Command.Group heading="Actions">
                            <Command.Item onSelect={run(onSync)}>
                                <Row
                                    icon={
                                        <RefreshCw className="size-4 text-muted-foreground" />
                                    }
                                    title="Sync device"
                                />
                            </Command.Item>
                            <Command.Item onSelect={run(onUpload)}>
                                <Row
                                    icon={
                                        <Upload className="size-4 text-muted-foreground" />
                                    }
                                    title="Upload audio"
                                />
                            </Command.Item>
                            <Command.Item onSelect={run(onOpenSettings)}>
                                <Row
                                    icon={
                                        <Settings className="size-4 text-muted-foreground" />
                                    }
                                    title="Open settings"
                                    accessory={<Kbd>,</Kbd>}
                                />
                            </Command.Item>
                            <Command.Item onSelect={run(onOpenShortcuts)}>
                                <Row
                                    icon={
                                        <Keyboard className="size-4 text-muted-foreground" />
                                    }
                                    title="Keyboard shortcuts"
                                    accessory={<Kbd>?</Kbd>}
                                />
                            </Command.Item>
                        </Command.Group>

                        {/* Theme */}
                        <Command.Group heading="Theme">
                            <Command.Item
                                onSelect={run(() => onSetTheme("light"))}
                            >
                                <Row
                                    icon={
                                        <Sun className="size-4 text-muted-foreground" />
                                    }
                                    title="Light"
                                    accessory={
                                        currentTheme === "light" ? (
                                            <span className="cmd-pill">
                                                Active
                                            </span>
                                        ) : null
                                    }
                                />
                            </Command.Item>
                            <Command.Item
                                onSelect={run(() => onSetTheme("dark"))}
                            >
                                <Row
                                    icon={
                                        <Moon className="size-4 text-muted-foreground" />
                                    }
                                    title="Dark"
                                    accessory={
                                        currentTheme === "dark" ? (
                                            <span className="cmd-pill">
                                                Active
                                            </span>
                                        ) : null
                                    }
                                />
                            </Command.Item>
                            <Command.Item
                                onSelect={run(() => onSetTheme("system"))}
                            >
                                <Row
                                    icon={
                                        <Monitor className="size-4 text-muted-foreground" />
                                    }
                                    title="Auto"
                                    accessory={
                                        currentTheme === "system" ? (
                                            <span className="cmd-pill">
                                                Active
                                            </span>
                                        ) : null
                                    }
                                />
                            </Command.Item>
                        </Command.Group>
                    </Command.List>

                    {/* Footer hints */}
                    <div className="cmd-footer">
                        <div className="cmd-footer-group">
                            <span className="cmd-footer-hint">
                                <Kbd>↑</Kbd>
                                <Kbd>↓</Kbd>
                                navigate
                            </span>
                            <span className="cmd-footer-hint">
                                <Kbd>↵</Kbd>
                                select
                            </span>
                            <span className="cmd-footer-hint">
                                <Kbd>esc</Kbd>
                                close
                            </span>
                            {/*
                              Only surface the ⌘↵ hint when there's at
                              least one row that would respond to it.
                              Otherwise it's noise: users see a keyboard
                              promise the palette can't keep on this view.
                            */}
                            {transcribeTargets.size > 0 && (
                                <span className="cmd-footer-hint">
                                    <Kbd>⌘</Kbd>
                                    <Kbd>↵</Kbd>
                                    transcribe
                                </span>
                            )}
                        </div>
                        <span className="cmd-footer-hint">
                            <Kbd>⌘K</Kbd>
                            toggle
                        </span>
                    </div>
                </Command>
            </DialogContent>
        </Dialog>
    );
}
