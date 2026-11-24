"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { BrowserTranscription } from "@/components/dashboard/transcribe-in-browser-button";
import {
    RecordingView,
    type RecordingViewRequest,
} from "@/components/recording/recording-view";
import {
    summaryProviderStateFor,
    transcriptionProviderStateFor,
} from "@/components/recording/summary-provider";
import type { RecordingTranscript } from "@/components/recording/types";
import type { Provider } from "@/components/settings-sections/providers-section";
import type { SummaryPrompts } from "@/hooks/use-summary-prompts";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

/** Transcript fields the dashboard loads per recording. */
export interface TranscriptionData {
    text?: string;
    language?: string;
    source?: string;
    provider?: string;
    transcriptionType?: string;
}

interface Props {
    currentRecording: Recording | null;
    currentTranscription: TranscriptionData | undefined;
    /** Recorder name for the current recording, when known. */
    deviceName: string | null;
    isCurrentTranscribing: boolean;
    visibleRecordings: Recording[];
    onTranscribe: () => void;
    /** Called after a browser-side transcription completes (refresh data). */
    onTranscribeComplete?: () => void;
    onSelectRecording: (r: Recording) => void;
    onRenamed?: (filename: string) => void;
    onDelete: (recording: Recording) => Promise<void>;
    onBackToList: () => void;
    /** When true, the pane is hidden (mobile list view active). */
    hiddenOnMobile: boolean;
    /** The user's AI providers, or null while not loaded yet. */
    providers: Provider[] | null;
    /** Loads `providers` (no-op when fresh or in flight). */
    onRequestProviders: () => void;
    initialPlaybackSpeed: number | undefined;
    initialVolume: number | undefined;
    initialAutoPlayNext: boolean | undefined;
    scrubberStyle: "waveform" | "slider" | undefined;
    /** Browser transcription runner shared with the library rows. */
    browser: BrowserTranscription;
    /** Summary styles shared with the library rows. */
    summaryPrompts: SummaryPrompts;
    /** Action a library row asked the reader to run. */
    request: RecordingViewRequest | null;
    /** Called after a summary is generated or deleted. */
    onSummaryChange: () => void;
    onSummarizingChange: (ids: ReadonlySet<string>) => void;
}

/**
 * Right-hand detail pane: the recording reader next to the library list
 * on lg+. Below lg the reader covers the screen while the list stays
 * mounted underneath, so scroll position, search and selection survive
 * going back.
 *
 * Auto-advance on player end (when auto-play-next is on) moves to the
 * next recording in `visibleRecordings`.
 */
export function WorkstationDetailPane({
    currentRecording,
    currentTranscription,
    deviceName,
    isCurrentTranscribing,
    visibleRecordings,
    onTranscribe,
    onTranscribeComplete,
    onSelectRecording,
    onRenamed,
    onDelete,
    onBackToList,
    hiddenOnMobile,
    providers,
    onRequestProviders,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
    browser,
    summaryPrompts,
    request,
    onSummaryChange,
    onSummarizingChange,
}: Props) {
    useEffect(() => {
        onRequestProviders();
    }, [onRequestProviders]);

    const transcripts = useMemo<RecordingTranscript[]>(
        () =>
            currentTranscription?.text
                ? [
                      {
                          source: currentTranscription.source ?? "riffado",
                          text: currentTranscription.text,
                          language: currentTranscription.language,
                          provider: currentTranscription.provider,
                          transcriptionType:
                              currentTranscription.transcriptionType,
                      },
                  ]
                : [],
        [currentTranscription],
    );

    const currentId = currentRecording?.id;
    const handleEnded = useCallback(() => {
        const currentIndex = visibleRecordings.findIndex(
            (r) => r.id === currentId,
        );
        if (currentIndex >= 0 && currentIndex < visibleRecordings.length - 1) {
            onSelectRecording(visibleRecordings[currentIndex + 1]);
        }
    }, [currentId, visibleRecordings, onSelectRecording]);

    return (
        <div className="lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
            {currentRecording ? (
                <RecordingView
                    className={cn(
                        "max-lg:transition-[opacity,translate,visibility] max-lg:ease-(--ease-out)",
                        hiddenOnMobile
                            ? "max-lg:invisible max-lg:translate-x-6 max-lg:opacity-0 max-lg:duration-(--duration-push-out)"
                            : "max-lg:duration-(--duration-push-in)",
                        "max-lg:motion-reduce:translate-x-0",
                    )}
                    recording={currentRecording}
                    deviceName={deviceName}
                    transcripts={transcripts}
                    isTranscribing={isCurrentTranscribing}
                    onTranscribe={onTranscribe}
                    onTranscribeComplete={onTranscribeComplete ?? (() => {})}
                    onRenamed={onRenamed}
                    onDelete={() => onDelete(currentRecording)}
                    back={{ label: "Library", onBack: onBackToList }}
                    summaryProviderState={summaryProviderStateFor(providers)}
                    transcriptionProviderState={transcriptionProviderStateFor(
                        providers,
                    )}
                    browser={browser}
                    summaryPrompts={summaryPrompts}
                    request={request}
                    onSummaryChange={onSummaryChange}
                    onSummarizingChange={onSummarizingChange}
                    player={{
                        initialPlaybackSpeed,
                        initialVolume,
                        initialAutoPlayNext,
                        scrubberStyle,
                        onEnded: handleEnded,
                    }}
                />
            ) : (
                <div className="flex flex-1 items-center justify-center bg-reader px-6 py-16 max-lg:hidden">
                    <p className="text-ui text-muted-foreground select-none">
                        Select a recording to read and listen.
                    </p>
                </div>
            )}
        </div>
    );
}
