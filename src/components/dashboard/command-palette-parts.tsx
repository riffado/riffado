"use client";

import { Command } from "cmdk";
import {
    Check,
    Keyboard,
    Monitor,
    Moon,
    RefreshCw,
    Settings,
    Sun,
    Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { recordingRowTone } from "@/components/dashboard/recording-row";
import {
    displayTitle,
    formatSpokenDuration,
} from "@/components/recording/format";
import { StatusDot } from "@/components/ui/status-dot";
import {
    type DateTimeFormat,
    formatDateTime,
    formatRowTime,
} from "@/lib/format-date";

import type { Recording } from "@/types/recording";

export const RECORDING_CAP = 200;

/** cmdk item value for a recording row; unique per recording. */
export function recordingItemValue(id: string): string {
    return `recording:${id}`;
}

interface TranscriptionData {
    text?: string;
    language?: string;
}

// Mirror of the helper in `recording-list.tsx`; kept local on both sides.
export function transcriptSnippet(
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
    return `${stripped.slice(0, maxChars - 1).trimEnd()}…`;
}

export function Row({
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

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="cmd-kbd">{children}</kbd>;
}

/** Plain ink check for the current item, with its meaning for screen readers. */
function CurrentMark({ label }: { label: string }) {
    return (
        <>
            <Check className="size-4 text-strong" aria-hidden="true" />
            <span className="sr-only">{label}</span>
        </>
    );
}

export function RecordingsGroup({
    recordings,
    transcriptions,
    currentRecording,
    inFlightActions,
    dateTimeFormat,
    onSelectRecording,
    onTranscribeRecording,
    runAction,
}: {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    dateTimeFormat: DateTimeFormat;
    onSelectRecording: (r: Recording) => void;
    onTranscribeRecording?: (id: string) => void;
    runAction: (fn: () => void) => () => void;
}) {
    if (recordings.length === 0) return null;
    const overflowCount = Math.max(0, recordings.length - RECORDING_CAP);
    const now = new Date();

    return (
        <Command.Group heading="Recent">
            {recordings.map((r) => {
                const snippet = transcriptSnippet(
                    transcriptions.get(r.id)?.text,
                );
                const inFlight = inFlightActions.get(r.id);
                const isCurrent = currentRecording?.id === r.id;

                const stateLabel = inFlight
                    ? inFlight === "transcribing"
                        ? "Transcribing"
                        : "Summarizing"
                    : r.hasTranscript
                      ? "Transcribed"
                      : "Not transcribed yet";

                const durationText =
                    r.duration != null
                        ? formatSpokenDuration(r.duration)
                        : null;
                // Same time detail as the library row's metadata line.
                const timeText =
                    dateTimeFormat === "relative"
                        ? formatRowTime(r.startTime, now)
                        : formatDateTime(r.startTime, dateTimeFormat);
                const subtitle: ReactNode = snippet
                    ? snippet
                    : durationText
                      ? `${durationText} · ${timeText}`
                      : timeText;

                let accessory: ReactNode = null;
                if (inFlight) {
                    accessory = `${stateLabel}…`;
                } else if (!r.hasTranscript && onTranscribeRecording) {
                    // stopPropagation: cmdk treats inner pointerdown as selection.
                    accessory = (
                        <button
                            type="button"
                            className="cmd-row-action"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTranscribeRecording(r.id);
                            }}
                            aria-label={`Transcribe ${displayTitle(r.filename)}`}
                        >
                            Transcribe
                        </button>
                    );
                } else if (isCurrent) {
                    accessory = <CurrentMark label="Selected" />;
                }

                return (
                    <Command.Item
                        key={r.id}
                        value={recordingItemValue(r.id)}
                        onSelect={runAction(() => onSelectRecording(r))}
                    >
                        <Row
                            icon={
                                <span
                                    title={stateLabel}
                                    className="flex size-4 items-center justify-center"
                                >
                                    <StatusDot
                                        tone={recordingRowTone(
                                            r.hasTranscript === true,
                                            inFlight,
                                        )}
                                    />
                                </span>
                            }
                            title={displayTitle(r.filename)}
                            subtitle={subtitle}
                            accessory={accessory}
                        />
                    </Command.Item>
                );
            })}
            {overflowCount > 0 && (
                <div className="cmd-more-hint">
                    +{overflowCount} more · refine your search to narrow the
                    list
                </div>
            )}
        </Command.Group>
    );
}

interface PaletteAction {
    title: string;
    icon: ReactNode;
    accessory?: ReactNode;
    run: () => void;
}

/** One cmdk group of fixed actions, showing only those whose title matches. */
function ActionItems({
    heading,
    actions,
    matches,
    runAction,
}: {
    heading: string;
    actions: PaletteAction[];
    matches: (label: string) => boolean;
    runAction: (fn: () => void) => () => void;
}) {
    const shown = actions.filter((a) => matches(a.title));
    if (shown.length === 0) return null;
    return (
        <Command.Group heading={heading}>
            {shown.map((a) => (
                <Command.Item
                    key={a.title}
                    value={a.title}
                    onSelect={runAction(a.run)}
                >
                    <Row
                        icon={a.icon}
                        title={a.title}
                        accessory={a.accessory}
                    />
                </Command.Item>
            ))}
        </Command.Group>
    );
}

export function ActionsGroup({
    onSync,
    onUpload,
    onOpenSettings,
    onOpenShortcuts,
    matches,
    runAction,
}: {
    onSync?: () => void;
    onUpload: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
    /** Whether an action title matches the current query. */
    matches: (label: string) => boolean;
    runAction: (fn: () => void) => () => void;
}) {
    const actions: PaletteAction[] = [
        ...(onSync
            ? [
                  {
                      title: "Sync now",
                      icon: (
                          <RefreshCw className="size-4 text-muted-foreground" />
                      ),
                      run: onSync,
                  },
              ]
            : []),
        {
            title: "Upload audio",
            icon: <Upload className="size-4 text-muted-foreground" />,
            run: onUpload,
        },
        {
            title: "Open settings",
            icon: <Settings className="size-4 text-muted-foreground" />,
            accessory: <Kbd>,</Kbd>,
            run: onOpenSettings,
        },
        {
            title: "Keyboard shortcuts",
            icon: <Keyboard className="size-4 text-muted-foreground" />,
            accessory: <Kbd>?</Kbd>,
            run: onOpenShortcuts,
        },
    ];
    return (
        <ActionItems
            heading="Actions"
            actions={actions}
            matches={matches}
            runAction={runAction}
        />
    );
}

export function ThemeGroup({
    currentTheme,
    onSetTheme,
    matches,
    runAction,
}: {
    currentTheme: "light" | "dark" | "system";
    onSetTheme: (t: "light" | "dark" | "system") => void;
    /** Whether a theme name matches the current query. */
    matches: (label: string) => boolean;
    runAction: (fn: () => void) => () => void;
}) {
    const themes = [
        { value: "light", title: "Light", Icon: Sun },
        { value: "dark", title: "Dark", Icon: Moon },
        { value: "system", title: "Auto", Icon: Monitor },
    ] as const;
    return (
        <ActionItems
            heading="Theme"
            actions={themes.map(({ value, title, Icon }) => ({
                title,
                icon: <Icon className="size-4 text-muted-foreground" />,
                accessory:
                    currentTheme === value ? (
                        <CurrentMark label="Active" />
                    ) : null,
                run: () => onSetTheme(value),
            }))}
            matches={matches}
            runAction={runAction}
        />
    );
}

export function PaletteFooter({
    showTranscribeHint,
}: {
    showTranscribeHint: boolean;
}) {
    return (
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
                {showTranscribeHint && (
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
    );
}
