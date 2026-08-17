"use client";

import { AudioWaveform, Loader2 } from "lucide-react";
import { DownloadAudioButton } from "@/components/recordings/download-audio-button";
import { RecordingTitle } from "@/components/recordings/recording-title";
import { CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/format-date";
import { formatDuration } from "@/lib/format-duration";
import type { Recording } from "@/types/recording";

interface Props {
    recording: Recording;
    /** Resolved playback duration in seconds (0 when not yet loaded). */
    duration: number;
    scrubberStyle: "waveform" | "slider";
    waveformStatus: "idle" | "ready" | "decoding" | "skipped" | "error";
    onDecodeWaveform: () => void;
    onRenamed?: (filename: string) => void;
}

/**
 * Title + compact metadata row + waveform-status footer for the
 * RecordingPlayer card. Lifted out so the parent's render reads as
 * "header + controls + audio element" instead of a 100-line JSX block.
 *
 * The metadata order is information-density-first: when (relative
 * date), then how long (duration), then how big (file size). Falls
 * back to recording.duration / 1000 before the audio element reports
 * a real duration so the line doesn't flicker on first paint.
 */
export function RecordingPlayerHeader({
    recording,
    duration,
    scrubberStyle,
    waveformStatus,
    onDecodeWaveform,
    onRenamed,
}: Props) {
    const metaParts: string[] = [
        formatDateTime(recording.startTime, "relative"),
        formatDuration(duration || recording.duration / 1000),
        formatBytes(recording.filesize),
    ];

    return (
        <CardHeader className="gap-1">
            <CardTitle className="min-w-0 text-lg">
                <RecordingTitle
                    recordingId={recording.id}
                    filename={recording.filename}
                    onRenamed={onRenamed}
                    className="text-lg"
                />
            </CardTitle>
            <CardAction>
                <DownloadAudioButton recordingId={recording.id} />
            </CardAction>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {metaParts.map((part, i) => (
                    <span key={part} className="inline-flex items-center gap-2">
                        {i > 0 && (
                            <span aria-hidden="true" className="opacity-40">
                                ·
                            </span>
                        )}
                        <span>{part}</span>
                    </span>
                ))}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "decoding" && (
                        <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true" className="opacity-40">
                                ·
                            </span>
                            <Loader2 className="size-3 animate-spin" />
                            Analyzing audio…
                        </span>
                    )}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "skipped" && (
                        <button
                            type="button"
                            onClick={onDecodeWaveform}
                            className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
                            title="Decode waveform in your browser (may take a few seconds)"
                        >
                            <span aria-hidden="true" className="opacity-40">
                                ·
                            </span>
                            <AudioWaveform className="size-3" />
                            Generate waveform
                        </button>
                    )}
                {scrubberStyle === "waveform" && waveformStatus === "error" && (
                    <button
                        type="button"
                        onClick={onDecodeWaveform}
                        className="inline-flex items-center gap-1 text-destructive underline-offset-2 hover:underline"
                    >
                        <span aria-hidden="true" className="opacity-40">
                            ·
                        </span>
                        <AudioWaveform className="size-3" />
                        Retry waveform
                    </button>
                )}
            </div>
        </CardHeader>
    );
}
