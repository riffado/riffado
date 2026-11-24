"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLinksLine } from "@/components/app-links";
import { RecordingView } from "@/components/recording/recording-view";
import { summaryProviderStateFor } from "@/components/recording/summary-provider";
import type {
    PlayerPreferences,
    RecordingTranscript,
} from "@/components/recording/types";
import { useProviderList } from "@/hooks/use-provider-list";
import { getApiErrorMessage } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import type { Recording } from "@/types/recording";

interface RecordingWorkstationProps extends PlayerPreferences {
    recording: Recording;
    /** All transcripts (one per source), primary first. */
    transcripts: RecordingTranscript[];
    /** Recorder name, when the serial matches a linked recorder. */
    deviceName: string | null;
    /** Picks the bug-report channels in the about links. Server-supplied. */
    isHosted: boolean;
}

/**
 * Standalone recording page (`/recordings/[id]`). Renders the same
 * `RecordingView` as the dashboard pane, full height, with a back link
 * to the library on every screen size. This page has no account menu,
 * so the about links (docs, source code, licence) close the reading
 * column.
 */
export function RecordingWorkstation({
    recording,
    transcripts,
    deviceName,
    isHosted,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
}: RecordingWorkstationProps) {
    const { push, refresh } = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [filename, setFilename] = useState(recording.filename);
    const { providers, prefetch: prefetchProviders } = useProviderList();

    useEffect(() => {
        setFilename(recording.filename);
    }, [recording.filename]);

    useEffect(() => {
        prefetchProviders();
    }, [prefetchProviders]);

    const displayRecording = useMemo(
        () =>
            filename === recording.filename
                ? recording
                : { ...recording, filename },
        [recording, filename],
    );

    const handleRenamed = useCallback(
        (next: string) => {
            setFilename(next);
            refresh();
        },
        [refresh],
    );

    const handleTranscribe = useCallback(async () => {
        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe`,
                { method: "POST" },
            );
            if (response.ok) {
                toast.success("Transcription complete");
                refresh();
            } else {
                toast.error(
                    await getApiErrorMessage(response, "Transcription failed"),
                );
            }
        } catch {
            toast.error("Failed to transcribe recording");
        } finally {
            setIsTranscribing(false);
        }
    }, [recording.id, refresh]);

    const handleDelete = useCallback(async () => {
        const response = await fetch(`/api/recordings/${recording.id}`, {
            method: "DELETE",
        });
        if (!response.ok) {
            throw new Error(
                await getApiErrorMessage(
                    response,
                    "Failed to delete recording",
                ),
            );
        }
        toast.success("Recording deleted");
        push("/dashboard");
        refresh();
    }, [recording.id, refresh, push]);

    return (
        <div className="flex h-dvh flex-col">
            <RecordingView
                recording={displayRecording}
                deviceName={deviceName}
                transcripts={transcripts}
                isTranscribing={isTranscribing}
                onTranscribe={handleTranscribe}
                onTranscribeComplete={refresh}
                onRenamed={handleRenamed}
                onDelete={handleDelete}
                back={{
                    label: "Library",
                    onBack: () => push("/dashboard"),
                    showOnDesktop: true,
                }}
                summaryProviderState={summaryProviderStateFor(providers)}
                footer={
                    <AppLinksLine
                        isHosted={isHosted}
                        className="mt-12 border-t border-hairline pt-4"
                    />
                }
                player={{
                    initialPlaybackSpeed,
                    initialVolume,
                    initialAutoPlayNext,
                    scrubberStyle,
                }}
            />
        </div>
    );
}
