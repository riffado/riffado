"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { RecordingContextEditor } from "@/components/dashboard/recording-context-editor";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface Props {
    currentRecording: Recording | null;
    currentTranscription: TranscriptionData | undefined;
    isCurrentTranscribing: boolean;
    visibleRecordings: Recording[];
    onTranscribe: () => void;
    onSelectRecording: (r: Recording) => void;
    onBackToList: () => void;
    /** When true, the pane is hidden (mobile list view active). */
    hiddenOnMobile: boolean;
    initialPlaybackSpeed: number | undefined;
    initialVolume: number | undefined;
    initialAutoPlayNext: boolean | undefined;
    scrubberStyle: "waveform" | "slider" | undefined;
    /**
     * Bubbled up from the progress poll inside TranscriptionPanel when
     * it observes that a server-side transcribe (one not started in
     * this React tree) finished. Parent calls `refresh()` so the
     * in-progress flag flips off and the panel switches to rendering
     * the transcript.
     */
    onServerTranscribeComplete?: () => void;
}

/**
 * Right-hand detail pane: player + transcription. On lg+ this is a
 * sticky column next to the recording list; on <lg the list and
 * detail toggle via `mobileView` -- both stay mounted so scroll
 * position / search query / selection survive a back-navigation.
 *
 * Auto-advance on player ended (when `autoPlayNext` is on) moves to
 * the next recording in `visibleRecordings`; the back-affordance is
 * mobile-only because desktop has both panes visible at once.
 */
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
    onServerTranscribeComplete,
}: Props) {
    const t = useTranslations("dashboard");
    return (
        <div
            className={cn(
                "space-y-6 lg:sticky lg:top-[4.5rem] lg:col-span-2 lg:block lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto lg:pr-1",
                hiddenOnMobile && "hidden",
            )}
        >
            {/*
              Mobile back affordance. Returns to the list view without
              dropping the selected recording -- reopening shows the
              same detail. Hidden on lg+ where both panes are visible
              at once.
            */}
            <Button
                variant="ghost"
                size="sm"
                onClick={onBackToList}
                className="-ml-2 h-9 gap-1 px-2 lg:hidden"
            >
                <ArrowLeft className="size-4" />
                {t("backToRecordings")}
            </Button>
            {currentRecording ? (
                <>
                    <RecordingPlayer
                        recording={currentRecording}
                        initialPlaybackSpeed={initialPlaybackSpeed}
                        initialVolume={initialVolume}
                        initialAutoPlayNext={initialAutoPlayNext}
                        scrubberStyle={scrubberStyle}
                        onEnded={() => {
                            const currentIndex = visibleRecordings.findIndex(
                                (r) => r.id === currentRecording.id,
                            );
                            if (
                                currentIndex >= 0 &&
                                currentIndex < visibleRecordings.length - 1
                            ) {
                                onSelectRecording(
                                    visibleRecordings[currentIndex + 1],
                                );
                            }
                        }}
                    />
                    <RecordingContextEditor
                        key={currentRecording.id}
                        recordingId={currentRecording.id}
                        initialContext={currentRecording.context ?? null}
                        onSaved={onServerTranscribeComplete}
                    />
                    <TranscriptionPanel
                        recording={currentRecording}
                        transcription={currentTranscription}
                        isTranscribing={isCurrentTranscribing}
                        onTranscribe={onTranscribe}
                        onServerTranscribeComplete={onServerTranscribeComplete}
                    />
                </>
            ) : (
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-muted-foreground">
                            {t("selectRecordingHint")}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
