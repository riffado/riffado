"use client";

import { ArrowLeft, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DotGridBackground } from "@/components/dashboard/dot-grid-background";
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

interface Ripple {
    id: number;
    x: number;
    y: number;
    startedAt: number;
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

    // ── Dot-grid background: cursor + ripple refs ─────────────────
    // We use plain refs (not state) so mouse-move never triggers a
    // React re-render — the canvas reads from these on every RAF frame.
    const cursorRef = useRef<{ x: number; y: number } | null>(null);
    const ripplesRef = useRef<Ripple[]>([]);
    const rippleIdRef = useRef(0);

    // Cursor position — only active when the pointer is directly over
    // the scroll container background (not over a panel child).
    const handleBackgroundMove = useCallback((e: React.MouseEvent) => {
        if (e.target !== e.currentTarget) {
            // Cursor moved onto a panel — dim the grid
            cursorRef.current = null;
            return;
        }
        cursorRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handleBackgroundLeave = useCallback(() => {
        cursorRef.current = null;
    }, []);

    // Click — add a ripple that the canvas will expand outward
    const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
        if (e.target !== e.currentTarget) return;
        const id = rippleIdRef.current++;
        const ripple: Ripple = {
            id,
            x: e.clientX,
            y: e.clientY,
            startedAt: performance.now(),
        };
        ripplesRef.current = [...ripplesRef.current.slice(-4), ripple];
        // Clean up after the ripple has fully faded
        window.setTimeout(() => {
            ripplesRef.current = ripplesRef.current.filter(
                (r) => r.id !== id,
            );
        }, 2000);
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

                    {/* Tab content — two-layer stack:
                         Layer 0 (absolute): canvas dot-grid, never scrolls
                         Layer 1 (absolute): transparent scroll container
                        The scroll container is transparent so the canvas
                        shows through; its e.target === e.currentTarget fires
                        for ALL empty background pixels (left, right, and
                        below the content column) — not only near the bottom. */}
                    <div className="relative flex-1 min-h-0">
                        {/* Dot-grid canvas — always covers visible area */}
                        <DotGridBackground
                            cursorRef={cursorRef}
                            ripplesRef={ripplesRef}
                        />

                        {/* Transparent scroll overlay — receives mouse events */}
                        <div
                            className="absolute inset-0 overflow-y-auto"
                            onMouseMove={handleBackgroundMove}
                            onMouseLeave={handleBackgroundLeave}
                            onClick={handleBackgroundClick}
                        >
                            {activeTab === "sources" ? (
                                <div className="mx-auto max-w-3xl space-y-6 p-6">
                                    {/* Player */}
                                    <RecordingPlayer
                                        recording={currentRecording}
                                        initialPlaybackSpeed={
                                            initialPlaybackSpeed
                                        }
                                        initialVolume={initialVolume}
                                        initialAutoPlayNext={
                                            initialAutoPlayNext
                                        }
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
                                                    visibleRecordings.length -
                                                        1
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
                    </div>
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
