"use client";

import { Command } from "cmdk";
import {
    ArrowDown,
    ArrowUp,
    Check,
    CornerDownLeft,
    Keyboard,
    Monitor,
    Moon,
    RefreshCw,
    Settings,
    Sun,
    Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { Keycap } from "@/components/dashboard/keycap";
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

/** ⌘ then Return, as one keycap. */
export function CommandEnterKeys() {
    return (
        <Keycap size="small" className="gap-0.5">
            ⌘<CornerDownLeft aria-hidden="true" />
            <span className="sr-only">Return</span>
        </Keycap>
    );
}

function TranscribeChip({
    title,
    onTranscribe,
}: {
    title: string;
    onTranscribe: () => void;
}) {
    return (
        <button
            type="button"
            className="cmd-row-action squircle flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border border-border bg-dialog-surface pr-1.5 pl-2.5 text-small leading-4.5 font-medium text-strong"
            // cmdk treats an inner pointerdown as selecting the row.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                onTranscribe();
            }}
            aria-label={`Transcribe ${title}`}
        >
            Transcribe
            <CommandEnterKeys />
        </button>
    );
}

export function RecordingsGroup({
    recordings,
    totalCount,
    heading,
    transcriptions,
    currentRecording,
    inFlightActions,
    dateTimeFormat,
    activeValue,
    onSelectRecording,
    onTranscribeRecording,
    runAction,
}: {
    /** The rows to show, already capped at `RECORDING_CAP`. */
    recordings: Recording[];
    /** How many recordings matched before the cap. */
    totalCount: number;
    heading: string;
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    dateTimeFormat: DateTimeFormat;
    /** cmdk value of the highlighted row; only that row offers Transcribe. */
    activeValue: string;
    onSelectRecording: (r: Recording) => void;
    onTranscribeRecording?: (id: string) => void;
    runAction: (fn: () => void) => () => void;
}) {
    if (recordings.length === 0) return null;
    const overflowCount = Math.max(0, totalCount - recordings.length);
    const now = new Date();

    return (
        <Command.Group heading={heading}>
            {recordings.map((r) => {
                const value = recordingItemValue(r.id);
                const title = displayTitle(r.filename);
                const inFlight = inFlightActions.get(r.id);
                const isCurrent = currentRecording?.id === r.id;
                const snippet = transcriptSnippet(
                    transcriptions.get(r.id)?.text,
                );
                const subtitle =
                    inFlight === "transcribing"
                        ? "Transcribing…"
                        : (snippet ??
                          (r.hasTranscript ? null : "Not transcribed yet"));
                const stateLabel = inFlight
                    ? inFlight === "transcribing"
                        ? "Transcribing"
                        : "Summarizing"
                    : r.hasTranscript
                      ? "Transcribed"
                      : "Not transcribed yet";
                const subtitleSaysState =
                    inFlight === "transcribing" ||
                    (!inFlight && !r.hasTranscript);
                // Same time detail as the library row's metadata line.
                const timeText =
                    dateTimeFormat === "relative"
                        ? formatRowTime(r.startTime, now)
                        : formatDateTime(r.startTime, dateTimeFormat);
                const canTranscribe =
                    onTranscribeRecording !== undefined &&
                    !r.hasTranscript &&
                    !inFlight &&
                    activeValue === value;

                return (
                    <Command.Item
                        key={r.id}
                        value={value}
                        data-current={isCurrent || undefined}
                        className="cmd-recording squircle"
                        onSelect={runAction(() => onSelectRecording(r))}
                    >
                        {isCurrent ? (
                            <span className="cmd-current-stripe" />
                        ) : null}
                        <span
                            className="flex h-10 w-2 shrink-0 items-start justify-center pt-1.75"
                            title={stateLabel}
                        >
                            <StatusDot
                                tone={recordingRowTone(
                                    r.hasTranscript === true,
                                    inFlight,
                                )}
                            />
                            {subtitleSaysState ? null : (
                                <span className="sr-only">{stateLabel}</span>
                            )}
                        </span>
                        <span className="cmd-body">
                            <span className="cmd-title text-ui leading-5 font-medium text-strong">
                                {title}
                            </span>
                            {subtitle ? (
                                <span className="cmd-subtitle text-small leading-4.5 text-muted-foreground">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                        {canTranscribe ? (
                            <TranscribeChip
                                title={title}
                                onTranscribe={() =>
                                    onTranscribeRecording?.(r.id)
                                }
                            />
                        ) : null}
                        <span className="flex w-18 shrink-0 flex-col items-end gap-0.5 tabular-nums">
                            {r.duration != null ? (
                                <span className="text-small leading-5 text-foreground">
                                    {formatSpokenDuration(r.duration)}
                                </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                                {timeText}
                            </span>
                        </span>
                    </Command.Item>
                );
            })}
            {overflowCount > 0 && (
                <div className="cmd-more-hint">
                    {overflowCount} more. Type to narrow the list
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
                    className="cmd-action squircle"
                    onSelect={runAction(a.run)}
                >
                    <span
                        aria-hidden="true"
                        className="flex shrink-0 text-subtle [&_svg]:size-4"
                    >
                        {a.icon}
                    </span>
                    <span className="cmd-title flex-1 text-ui leading-5 text-strong">
                        {a.title}
                    </span>
                    {a.accessory ? (
                        <span className="flex shrink-0 items-center">
                            {a.accessory}
                        </span>
                    ) : null}
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
            ? [{ title: "Sync now", icon: <RefreshCw />, run: onSync }]
            : []),
        { title: "Upload audio", icon: <Upload />, run: onUpload },
        {
            title: "Open settings",
            icon: <Settings />,
            accessory: <Keycap size="small">,</Keycap>,
            run: onOpenSettings,
        },
        {
            title: "Keyboard shortcuts",
            icon: <Keyboard />,
            accessory: <Keycap size="small">?</Keycap>,
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
                icon: <Icon />,
                accessory:
                    currentTheme === value ? (
                        <>
                            <Check
                                className="size-4 text-strong"
                                aria-hidden="true"
                            />
                            <span className="sr-only">Active</span>
                        </>
                    ) : null,
                run: () => onSetTheme(value),
            }))}
            matches={matches}
            runAction={runAction}
        />
    );
}

function FooterHint({
    keys,
    children,
}: {
    keys: ReactNode;
    children: ReactNode;
}) {
    return (
        <span className="flex items-center gap-1.5">
            <span className="flex gap-1">{keys}</span>
            {children}
        </span>
    );
}

/**
 * Key hints under the list. Transcribe shows only while the highlighted
 * row can be transcribed, matching its chip.
 */
export function PaletteFooter({
    showTranscribeHint,
}: {
    showTranscribeHint: boolean;
}) {
    return (
        <div className="flex h-11 shrink-0 items-center gap-4 border-t border-border bg-surface px-5 text-xs text-muted-foreground select-none">
            <FooterHint
                keys={
                    <>
                        <Keycap size="small">
                            <ArrowUp aria-hidden="true" />
                            <span className="sr-only">Up arrow</span>
                        </Keycap>
                        <Keycap size="small">
                            <ArrowDown aria-hidden="true" />
                            <span className="sr-only">Down arrow</span>
                        </Keycap>
                    </>
                }
            >
                Move
            </FooterHint>
            <FooterHint
                keys={
                    <Keycap size="small">
                        <CornerDownLeft aria-hidden="true" />
                        <span className="sr-only">Return</span>
                    </Keycap>
                }
            >
                Open
            </FooterHint>
            {showTranscribeHint ? (
                <FooterHint keys={<CommandEnterKeys />}>Transcribe</FooterHint>
            ) : null}
            <span className="flex-1" />
            <FooterHint keys={<Keycap size="small">esc</Keycap>}>
                Close
            </FooterHint>
        </div>
    );
}
