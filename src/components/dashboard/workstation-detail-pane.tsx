"use client";

import { ArrowLeft, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

type DetailTab = "sources" | "notes";

interface Props {
    currentRecording: Recording | null;
    currentTranscription: TranscriptionData | undefined;
    isCurrentTranscribing: boolean;
    visibleRecordings: Recording[];
    onTranscribe: () => void;
    /** Refresh server data (transcriptions/summaries) after generation. */
    onDataRefresh?: () => void;
    onSelectRecording: (r: Recording) => void;
    onBackToList: () => void;
    hiddenOnMobile: boolean;
    initialPlaybackSpeed: number | undefined;
    initialVolume: number | undefined;
    initialAutoPlayNext: boolean | undefined;
    scrubberStyle: "waveform" | "slider" | undefined;
}

export function WorkstationDetailPane({
    currentRecording,
    currentTranscription,
    isCurrentTranscribing,
    visibleRecordings,
    onTranscribe,
    onDataRefresh,
    onSelectRecording,
    onBackToList,
    hiddenOnMobile,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
}: Props) {
    const [activeTab, setActiveTab] = useState<DetailTab>("sources");

    // When the user selects a different recording, auto-switch to:
    //   • "notes"   if it already has a summary
    //   • "sources" if it's untranscribed (show the Generate button)
    const prevRecordingId = useRef<string | null>(null);
    useEffect(() => {
        if (!currentRecording) return;
        if (currentRecording.id === prevRecordingId.current) return;
        prevRecordingId.current = currentRecording.id;

        if (currentRecording.hasSummary) {
            setActiveTab("notes");
        } else {
            setActiveTab("sources");
        }
    }, [currentRecording]);

    // ── Cursor-trail dots over the empty background around the panels ──
    // Only fires when the cursor is directly over the scroll container's
    // own background (the negative space beside / below the centered
    // max-w-3xl column) — never over a panel, because hovering a panel
    // makes the panel the event target, not the scroll container.
    const [dots, setDots] = useState<{ id: number; x: number; y: number }[]>(
        [],
    );
    const dotIdRef = useRef(0);
    const lastDotRef = useRef({ x: 0, y: 0, t: 0 });

    const handleBackgroundMove = useCallback((e: React.MouseEvent) => {
        // Restrict to the bare background: the scroll container itself.
        if (e.target !== e.currentTarget) return;
        const now = performance.now();
        const dx = e.clientX - lastDotRef.current.x;
        const dy = e.clientY - lastDotRef.current.y;
        // Throttle by time + distance so we emit a sparse trail, not a flood.
        if (now - lastDotRef.current.t < 45 || Math.hypot(dx, dy) < 16) {
            return;
        }
        lastDotRef.current = { x: e.clientX, y: e.clientY, t: now };
        const id = dotIdRef.current++;
        setDots((prev) => [
            ...prev.slice(-28),
            { id, x: e.clientX, y: e.clientY },
        ]);
        window.setTimeout(() => {
            setDots((prev) => prev.filter((d) => d.id !== id));
        }, 850);
    }, []);

    // Derive a clean display title from the filename
    const recordingTitle = currentRecording?.filename
        ? currentRecording.filename.replace(/\.[^.]+$/, "")
        : null;

    return (
        <div
            className={cn(
                "flex flex-1 flex-col min-w-0 lg:block",
                hiddenOnMobile && "hidden",
            )}
        >
            {currentRecording ? (
                <div className="flex flex-1 flex-col h-full">
                    {/* Back button (mobile only) */}
                    <div className="flex items-center border-b border-border/40 px-4 py-2 lg:hidden">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onBackToList}
                            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="size-3.5" />
                            Back
                        </Button>
                    </div>

                    {/* Sources / Notes tab bar — Plaud-style */}
                    <div className="flex items-center justify-center gap-6 border-b border-border/40 px-6 pt-4 pb-0">
                        <button
                            type="button"
                            onClick={() => setActiveTab("sources")}
                            className={cn(
                                "relative pb-3 text-sm font-semibold transition-colors",
                                activeTab === "sources"
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground/70",
                            )}
                        >
                            Sources
                            {activeTab === "sources" && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("notes")}
                            className={cn(
                                "relative pb-3 text-sm font-semibold transition-colors",
                                activeTab === "notes"
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground/70",
                            )}
                        >
                            Notes
                            {activeTab === "notes" && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
                            )}
                        </button>
                    </div>

                    {/* Tab content */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: Background captures cursor movement for aesthetic dot trail */}
                    <div
                        className="relative flex-1 overflow-y-auto"
                        onMouseMove={handleBackgroundMove}
                    >
                        {activeTab === "sources" ? (
                            <div className="mx-auto max-w-3xl space-y-6 p-6">
                                {/* Player */}
                                <RecordingPlayer
                                    recording={currentRecording}
                                    initialPlaybackSpeed={initialPlaybackSpeed}
                                    initialVolume={initialVolume}
                                    initialAutoPlayNext={initialAutoPlayNext}
                                    scrubberStyle={scrubberStyle}
                                    onEnded={() => {
                                        const currentIndex =
                                            visibleRecordings.findIndex(
                                                (r) =>
                                                    r.id ===
                                                    currentRecording.id,
                                            );
                                        if (
                                            currentIndex >= 0 &&
                                            currentIndex <
                                                visibleRecordings.length - 1
                                        ) {
                                            onSelectRecording(
                                                visibleRecordings[
                                                    currentIndex + 1
                                                ],
                                            );
                                        }
                                    }}
                                />
                                {/* Transcript section */}
                                <TranscriptionPanel
                                    recording={currentRecording}
                                    transcription={currentTranscription}
                                    isTranscribing={isCurrentTranscribing}
                                    onTranscribe={onTranscribe}
                                    onGenerated={onDataRefresh}
                                    showSummary={false}
                                    onPipelineComplete={() =>
                                        setActiveTab("notes")
                                    }
                                />
                            </div>
                        ) : (
                            <div className="mx-auto max-w-3xl p-6 space-y-4">
                                {/* Recording title above the summary */}
                                {recordingTitle && (
                                    <div className="pb-1 border-b border-border/40">
                                        <h2 className="text-lg font-semibold leading-tight truncate">
                                            {recordingTitle}
                                        </h2>
                                    </div>
                                )}
                                {/* Notes tab — summary / AI notes */}
                                <TranscriptionPanel
                                    recording={currentRecording}
                                    transcription={currentTranscription}
                                    isTranscribing={isCurrentTranscribing}
                                    onTranscribe={onTranscribe}
                                    onGenerated={onDataRefresh}
                                    showTranscript={false}
                                />
                            </div>
                        )}
                    </div>

                    {/* Cursor-trail dots over the empty background. Fixed +
                        pointer-events-none so they never block interaction. */}
                    {dots.length > 0 && (
                        <div className="pointer-events-none fixed inset-0 z-50">
                            {dots.map((d) => (
                                <span
                                    key={d.id}
                                    className="hover-dot"
                                    style={{ left: d.x, top: d.y }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <div className="rounded-full bg-muted/40 p-5">
                        <Mic className="size-8 text-muted-foreground/30" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">
                            Select a recording
                        </p>
                        <p className="text-xs text-muted-foreground/60">
                            Choose a recording from the list to view its
                            transcript and notes
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
