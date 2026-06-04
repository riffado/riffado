"use client";

import { ArrowLeft, Mic } from "lucide-react";
import { useState } from "react";
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
    onSelectRecording,
    onBackToList,
    hiddenOnMobile,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
}: Props) {
    const [activeTab, setActiveTab] = useState<DetailTab>("sources");

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
                    <div className="flex-1 overflow-y-auto">
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
                                    showSummary={false}
                                />
                            </div>
                        ) : (
                            <div className="mx-auto max-w-3xl p-6">
                                {/* Notes tab — summary / AI notes */}
                                <TranscriptionPanel
                                    recording={currentRecording}
                                    transcription={currentTranscription}
                                    isTranscribing={isCurrentTranscribing}
                                    onTranscribe={onTranscribe}
                                    showTranscript={false}
                                />
                            </div>
                        )}
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
