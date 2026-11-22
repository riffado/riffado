"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { useBrowserTranscription } from "@/components/dashboard/transcribe-in-browser-button";
import {
    formatRecordedAt,
    formatSpokenDuration,
    transcriptOriginLabel,
} from "@/components/recording/format";
import { RecordingOverviewTab } from "@/components/recording/recording-overview";
import { RecordingTopBar } from "@/components/recording/recording-top-bar";
import { RecordingTranscriptTab } from "@/components/recording/recording-transcript";
import type {
    PlayerPreferences,
    RecordingTranscript,
    SummaryProviderState,
} from "@/components/recording/types";
import { RecordingTitle } from "@/components/recordings/recording-title";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

type Tab = "overview" | "transcript";

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
    player: PlayerPreferences & { onEnded?: () => void };
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
    player,
    className,
}: RecordingViewProps) {
    const confirm = useConfirm();
    const [activeSource, setActiveSource] = useState<string | undefined>();
    const active =
        transcripts.find((t) => t.source === activeSource) ?? transcripts[0];
    const hasTranscript = Boolean(active?.text);

    const {
        summaryData,
        isSummarizing,
        summaryPreset,
        summaryPromptOptions,
        summaryError,
        handleSummarize,
        handleDeleteSummary,
    } = useTranscriptionSummary({
        recordingId: recording.id,
        transcriptionText: active?.text,
    });

    const browser = useBrowserTranscription({
        recordingId: recording.id,
        onComplete: onTranscribeComplete,
    });

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
        void confirm({
            title: "Delete this recording?",
            description: (
                <>
                    <span className="font-medium text-foreground">
                        {recording.filename}
                    </span>
                    <br />
                    The audio, transcript and summary are removed from Riffado.
                    A copy in your Plaud account stays there and won't sync
                    back.
                </>
            ),
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: onDelete,
        });
    };

    return (
        <article
            aria-label={recording.filename}
            className={cn(
                "relative flex flex-col bg-background max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:pt-[env(safe-area-inset-top)] lg:min-h-0 lg:min-w-0 lg:flex-1 lg:bg-reader",
                className,
            )}
        >
            <RecordingTopBar
                recordingId={recording.id}
                title={recording.filename}
                origin={transcriptOriginLabel(active)}
                back={back}
                hasTranscript={hasTranscript}
                hasSummary={Boolean(summaryData?.summary)}
                isTranscribing={isTranscribing}
                browserBusy={browser.isRunning}
                isSummarizing={isSummarizing}
                summaryPreset={summaryPreset}
                summaryPresets={summaryPromptOptions}
                onRename={() => setRenaming(true)}
                onTranscribe={() => {
                    setTab("transcript");
                    onTranscribe();
                }}
                onTranscribeInBrowser={() => {
                    setTab("transcript");
                    void browser.start();
                }}
                onSummarize={(preset) => {
                    setTab("overview");
                    void handleSummarize(preset);
                }}
                onDeleteSummary={() => void handleDeleteSummary()}
                onDelete={requestDelete}
            />

            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
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
                                aria-label="Recording sections"
                                className="squircle flex rounded-[var(--radius-item)] bg-surface p-0.75 lg:gap-7 lg:rounded-none lg:border-b lg:border-border lg:bg-transparent lg:p-0"
                            >
                                <TabTrigger value="overview" label="Overview" />
                                <TabTrigger
                                    value="transcript"
                                    label="Transcript"
                                />
                            </TabsPrimitive.List>
                            <TabsPrimitive.Content
                                value="overview"
                                className="outline-none"
                            >
                                <RecordingOverviewTab
                                    hasTranscript={hasTranscript}
                                    summary={summaryData}
                                    isSummarizing={isSummarizing}
                                    error={summaryError}
                                    providerState={summaryProviderState}
                                    onSummarize={() => void handleSummarize()}
                                />
                            </TabsPrimitive.Content>
                            <TabsPrimitive.Content
                                value="transcript"
                                className="outline-none"
                            >
                                <RecordingTranscriptTab
                                    transcripts={transcripts}
                                    active={active}
                                    onSelectSource={setActiveSource}
                                    isTranscribing={isTranscribing}
                                    browserPhase={browser.phase}
                                    browserBusy={browser.isRunning}
                                    onTranscribe={onTranscribe}
                                    onTranscribeInBrowser={() =>
                                        void browser.start()
                                    }
                                />
                            </TabsPrimitive.Content>
                        </TabsPrimitive.Root>
                    </div>

                    {/* Sticky in the same column as the content, so the
                        player lines up with it, content scrolls under it,
                        and the last line always clears it. */}
                    <div className="pointer-events-none sticky bottom-0 mt-auto -mx-5 bg-linear-to-b from-transparent to-background to-40% px-3 pt-8 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:mx-0 lg:bg-none lg:px-0 lg:pt-9 lg:pb-7">
                        <RecordingPlayer
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

function TabTrigger({ value, label }: { value: Tab; label: string }) {
    return (
        <TabsPrimitive.Trigger
            value={value}
            className={cn(
                "group squircle flex h-8.5 flex-1 items-center justify-center rounded-[var(--radius-control)] text-ui text-subtle outline-none transition-colors select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "data-[state=active]:bg-reader data-[state=active]:text-strong data-[state=active]:shadow-sm",
                "lg:-mb-px lg:h-auto lg:flex-none lg:rounded-none lg:border-b-2 lg:border-transparent lg:pb-3 lg:data-[state=active]:border-strong lg:data-[state=active]:bg-transparent lg:data-[state=active]:shadow-none",
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
