"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
    RecordingPlayer,
    type RecordingPlayerHandle,
} from "@/components/dashboard/recording-player";
import {
    type BrowserTranscription,
    useBrowserTranscription,
} from "@/components/dashboard/transcribe-in-browser-button";
import {
    formatRecordedAt,
    formatSpokenDuration,
    transcriptOriginLabel,
} from "@/components/recording/format";
import { confirmDeleteRecording } from "@/components/recording/recording-actions";
import { RecordingOverviewTab } from "@/components/recording/recording-overview";
import { RecordingTopBar } from "@/components/recording/recording-top-bar";
import { RecordingTranscriptTab } from "@/components/recording/recording-transcript";
import type {
    PlayerPreferences,
    RecordingTranscript,
    SummaryProviderState,
    TranscriptionProviderState,
} from "@/components/recording/types";
import { RecordingTitle } from "@/components/recordings/recording-title";
import type { SummaryPrompts } from "@/hooks/use-summary-prompts";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

type Tab = "overview" | "transcript";

/**
 * An action a library row asked the reader to run once it shows that
 * recording: inline rename lives in the title, and summaries show their
 * progress, result and errors in the Overview tab. `key` changes per
 * request so the same action can be asked for twice.
 */
export interface RecordingViewRequest {
    recordingId: string;
    action: "rename" | "summarize" | "delete-summary";
    /** Summary style for `summarize`. */
    promptId?: string;
    key: number;
}

interface RecordingViewProps {
    recording: Recording;
    /** Recorder name from the device list, or null when unknown. */
    deviceName?: string | null;
    /** All transcripts for the recording, primary first. */
    transcripts: RecordingTranscript[];
    isTranscribing: boolean;
    onTranscribe: () => void;
    /** Refresh after a browser-side transcription is saved. */
    onTranscribeComplete: () => void;
    onRenamed?: (filename: string) => void;
    /** Deletes the recording; throw to keep the confirm dialog open. */
    onDelete: () => Promise<void>;
    /** Back link. Phones always show it; desktop only with `showOnDesktop`. */
    back?: { label: string; onBack: () => void; showOnDesktop?: boolean };
    summaryProviderState: SummaryProviderState;
    /**
     * Whether server transcription has a provider. Without one, browser
     * transcription leads and server Transcribe is hidden. Defaults to
     * `unknown`, which behaves like `ready`.
     */
    transcriptionProviderState?: TranscriptionProviderState;
    player: PlayerPreferences & { onEnded?: () => void };
    /** Browser transcription runner shared with other surfaces. */
    browser?: BrowserTranscription;
    /** Summary styles shared with other surfaces. */
    summaryPrompts?: SummaryPrompts;
    /** Action requested from a library row for this recording. */
    request?: RecordingViewRequest | null;
    /** Called after a summary is generated or deleted. */
    onSummaryChange?: () => void;
    /** Reports every recording this view is summarizing. */
    onSummarizingChange?: (ids: ReadonlySet<string>) => void;
    className?: string;
}

/**
 * The recording reader shared by the dashboard pane and the standalone
 * recording page: top bar, big title with meta, Overview / Transcript
 * tabs, and the night player floating over the bottom of the content.
 *
 * Fills its parent on lg+; below lg it covers the screen (fixed) with the
 * player docked at the bottom, so the library list underneath keeps its
 * scroll position.
 */
export function RecordingView({
    recording,
    deviceName,
    transcripts,
    isTranscribing,
    onTranscribe,
    onTranscribeComplete,
    onRenamed,
    onDelete,
    back,
    summaryProviderState,
    transcriptionProviderState = "unknown",
    player,
    browser: sharedBrowser,
    summaryPrompts,
    request,
    onSummaryChange,
    onSummarizingChange,
    className,
}: RecordingViewProps) {
    const confirm = useConfirm();
    const [activeSource, setActiveSource] = useState<string | undefined>();
    const active =
        transcripts.find((t) => t.source === activeSource) ?? transcripts[0];
    const hasTranscript = Boolean(active?.text);

    const {
        summaryData,
        summaryLoadStatus,
        retrySummaryLoad,
        isSummarizing,
        summarizingIds,
        summaryPreset,
        summaryPromptOptions,
        summaryError,
        handleSummarize,
        handleDeleteSummary,
    } = useTranscriptionSummary({
        recordingId: recording.id,
        transcriptionText: active?.text,
        prompts: summaryPrompts,
        onSummaryChange,
    });

    const ownBrowser = useBrowserTranscription({
        onComplete: onTranscribeComplete,
    });
    const browser = sharedBrowser ?? ownBrowser;

    const defaultTab: Tab =
        recording.hasSummary && hasTranscript ? "overview" : "transcript";
    const [tab, setTab] = useState<Tab>(defaultTab);
    const [renaming, setRenaming] = useState(false);
    const [shownId, setShownId] = useState(recording.id);
    if (shownId !== recording.id) {
        setShownId(recording.id);
        setTab(defaultTab);
        setRenaming(false);
        setActiveSource(undefined);
    }

    const requestDelete = () => {
        void confirmDeleteRecording(confirm, recording, onDelete);
    };

    const handledRequest = useRef<number | null>(null);
    useEffect(() => {
        if (!request || request.recordingId !== recording.id) return;
        if (handledRequest.current === request.key) return;
        handledRequest.current = request.key;
        if (request.action === "rename") {
            setRenaming(true);
        } else if (request.action === "summarize") {
            setTab("overview");
            void handleSummarize(request.promptId);
        } else {
            void handleDeleteSummary();
        }
    }, [request, recording.id, handleSummarize, handleDeleteSummary]);

    useEffect(() => {
        onSummarizingChange?.(summarizingIds);
    }, [summarizingIds, onSummarizingChange]);
    useEffect(
        () => () => onSummarizingChange?.(new Set()),
        [onSummarizingChange],
    );

    const browserPhase = browser.phaseFor(recording.id);
    const serverTranscription = transcriptionProviderState !== "missing";
    const transcribe = {
        isTranscribing,
        browserPhase,
        browserBusy: browser.isRunning,
        providerState: transcriptionProviderState,
        onTranscribe,
        onTranscribeInBrowser: () => void browser.start(recording.id),
    };

    const playerRef = useRef<RecordingPlayerHandle>(null);
    const playFrom = (seconds: number) => playerRef.current?.playFrom(seconds);

    const tabListRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    const placedForRef = useRef<string | null>(null);
    // One indicator travels between the tabs (transform only). It
    // animates only after its first placement, so it never slides in on
    // load or when another recording opens.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` changes which trigger is active, so the indicator moves
    useLayoutEffect(() => {
        const list = tabListRef.current;
        const bar = indicatorRef.current;
        if (!list || !bar) return;
        if (placedForRef.current !== shownId) {
            placedForRef.current = shownId;
            delete bar.dataset.ready;
        }
        const place = () => {
            const active = list.querySelector<HTMLElement>(
                '[role="tab"][data-state="active"]',
            );
            if (!active) return;
            const x = active.offsetLeft;
            const w = active.offsetWidth;
            if (window.matchMedia?.("(min-width: 64rem)").matches) {
                bar.style.width = "";
                bar.style.transform = `translateX(${x}px) scaleX(${w})`;
            } else {
                bar.style.width = `${w}px`;
                bar.style.transform = `translateX(${x}px)`;
            }
        };
        place();
        const frame = requestAnimationFrame(() => {
            bar.dataset.ready = "";
        });
        if (typeof ResizeObserver === "undefined") {
            return () => cancelAnimationFrame(frame);
        }
        const observer = new ResizeObserver(place);
        observer.observe(list);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [tab, shownId]);

    return (
        <article
            aria-label={recording.filename}
            className={cn(
                "relative flex flex-col bg-background max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:pt-[env(safe-area-inset-top)] lg:min-h-0 lg:min-w-0 lg:flex-1 lg:bg-reader",
                className,
            )}
        >
            <RecordingTopBar
                title={recording.filename}
                origin={transcriptOriginLabel(active)}
                back={back}
                actions={{
                    recordingId: recording.id,
                    hasTranscript,
                    hasSummary: Boolean(summaryData?.summary),
                    transcribing: isTranscribing
                        ? "server"
                        : browserPhase !== "idle"
                          ? "browser"
                          : null,
                    browserAvailable: !browser.isRunning,
                    serverTranscription,
                    isSummarizing,
                    summaryPrompts: summaryPromptOptions,
                    currentPromptId: summaryPreset,
                    onRename: () => setRenaming(true),
                    onTranscribe: () => {
                        setTab("transcript");
                        onTranscribe();
                    },
                    onTranscribeInBrowser: () => {
                        setTab("transcript");
                        void browser.start(recording.id);
                    },
                    onSummarize: (preset) => {
                        setTab("overview");
                        void handleSummarize(preset);
                    },
                    onDeleteSummary: () => void handleDeleteSummary(),
                    onDelete: requestDelete,
                }}
            />

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                <div className="flex min-h-full flex-col px-5 pt-4.5 lg:px-10 lg:pt-7 xl:px-24">
                    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 lg:gap-9">
                        <header className="flex flex-col gap-2.5 xl:gap-4.5">
                            <h1 className="font-display text-document-title-compact font-medium text-strong xl:text-document-title">
                                <RecordingTitle
                                    variant="display"
                                    recordingId={recording.id}
                                    filename={recording.filename}
                                    onRenamed={onRenamed}
                                    editing={renaming}
                                    onEditingChange={setRenaming}
                                />
                            </h1>
                            <RecordingMeta
                                startTime={recording.startTime}
                                durationMs={recording.duration}
                                deviceName={deviceName ?? null}
                            />
                        </header>

                        <TabsPrimitive.Root
                            value={tab}
                            onValueChange={(next) => setTab(next as Tab)}
                            className="flex flex-col gap-5 lg:gap-9"
                        >
                            <TabsPrimitive.List
                                ref={tabListRef}
                                aria-label="Recording sections"
                                className="squircle relative flex rounded-[var(--radius-item)] bg-surface p-0.75 lg:gap-7 lg:rounded-none lg:border-b lg:border-border lg:bg-transparent lg:p-0"
                            >
                                <span
                                    ref={indicatorRef}
                                    aria-hidden="true"
                                    className="squircle pointer-events-none absolute top-0.75 bottom-0.75 left-0 origin-left rounded-[var(--radius-control)] bg-reader shadow-sm motion-safe:data-[ready]:transition-transform motion-safe:data-[ready]:duration-(--duration-indicator) motion-safe:data-[ready]:ease-(--ease-in-out) lg:top-auto lg:-bottom-px lg:h-0.5 lg:w-px lg:rounded-none lg:bg-strong lg:shadow-none"
                                />
                                <TabTrigger value="overview" label="Overview" />
                                <TabTrigger
                                    value="transcript"
                                    label="Transcript"
                                />
                            </TabsPrimitive.List>
                            <TabsPrimitive.Content
                                value="overview"
                                className={TAB_PANEL_CLASS}
                            >
                                <RecordingOverviewTab
                                    hasTranscript={hasTranscript}
                                    summary={summaryData}
                                    loadStatus={summaryLoadStatus}
                                    expectSummary={
                                        recording.hasSummary === true
                                    }
                                    onRetryLoad={retrySummaryLoad}
                                    isSummarizing={isSummarizing}
                                    error={summaryError}
                                    providerState={summaryProviderState}
                                    onSummarize={() => void handleSummarize()}
                                    transcribe={transcribe}
                                />
                            </TabsPrimitive.Content>
                            <TabsPrimitive.Content
                                value="transcript"
                                className={TAB_PANEL_CLASS}
                            >
                                <RecordingTranscriptTab
                                    transcripts={transcripts}
                                    active={active}
                                    onSelectSource={setActiveSource}
                                    onPlayFrom={playFrom}
                                    {...transcribe}
                                />
                            </TabsPrimitive.Content>
                        </TabsPrimitive.Root>
                    </div>

                    {/* Sticky in the same column as the content, so the
                        player lines up with it, content scrolls under it,
                        and the last line always clears it. */}
                    <div className="pointer-events-none sticky bottom-0 mt-auto -mx-5 bg-linear-to-b from-transparent to-background to-40% px-3 pt-8 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:mx-0 lg:bg-none lg:px-0 lg:pt-9 lg:pb-7">
                        <RecordingPlayer
                            controlRef={playerRef}
                            recording={recording}
                            initialPlaybackSpeed={player.initialPlaybackSpeed}
                            initialVolume={player.initialVolume}
                            initialAutoPlayNext={player.initialAutoPlayNext}
                            scrubberStyle={player.scrubberStyle}
                            onEnded={player.onEnded}
                            className="pointer-events-auto mx-auto max-w-2xl"
                        />
                    </div>
                </div>
            </div>
        </article>
    );
}

/**
 * Tab panels stay tab stops (Radix default, per the WAI-ARIA tabs
 * pattern: the summary and transcript text has nothing focusable to
 * land on), so they get the visible focus ring.
 */
const TAB_PANEL_CLASS =
    "squircle rounded-[var(--radius-inner)] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-6 focus-visible:outline-solid focus-visible:outline-ring/50";

function TabTrigger({ value, label }: { value: Tab; label: string }) {
    return (
        <TabsPrimitive.Trigger
            value={value}
            className={cn(
                "group squircle relative z-10 flex h-8.5 flex-1 items-center justify-center rounded-[var(--radius-control)] text-ui text-subtle outline-none transition-colors duration-(--duration-indicator) ease-(--ease-in-out) select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "data-[state=active]:text-strong",
                "lg:-mb-px lg:h-auto lg:flex-none lg:rounded-none lg:border-b-2 lg:border-transparent lg:pb-3",
                "hover:text-strong",
            )}
        >
            {/* The bold copy reserves the active width so tabs never shift. */}
            <span className="grid">
                <span
                    aria-hidden="true"
                    className="invisible col-start-1 row-start-1 font-semibold"
                >
                    {label}
                </span>
                <span className="col-start-1 row-start-1 font-medium group-data-[state=active]:font-semibold">
                    {label}
                </span>
            </span>
        </TabsPrimitive.Trigger>
    );
}

/** Date and time, duration and recorder, separated by middle dots. */
function RecordingMeta({
    startTime,
    durationMs,
    deviceName,
}: {
    startTime: string;
    durationMs: number;
    deviceName: string | null;
}) {
    // Local time only renders on the client so server and browser time
    // zones can't disagree during hydration.
    const [recordedAt, setRecordedAt] = useState<string | null>(null);
    useEffect(() => {
        setRecordedAt(formatRecordedAt(startTime, new Date()));
    }, [startTime]);

    const parts = [
        recordedAt,
        formatSpokenDuration(durationMs),
        deviceName,
    ].filter((p): p is string => Boolean(p));

    return (
        <p className="flex min-h-4.5 flex-wrap items-center gap-x-2 gap-y-1 text-ui text-subtle xl:gap-x-4">
            {parts.map((part, i) => (
                <span key={part} className="contents">
                    {i > 0 ? (
                        <span aria-hidden="true" className="text-border">
                            ·
                        </span>
                    ) : null}
                    <span className="tabular-nums">{part}</span>
                </span>
            ))}
        </p>
    );
}
