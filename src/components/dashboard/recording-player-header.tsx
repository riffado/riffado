"use client";

import { AudioWaveform, Loader2 } from "lucide-react";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/format-date";
import { formatDuration } from "@/lib/format-duration";
import { getFiletagIcon } from "@/lib/plaud/filetag-icons";
import type { Filetag } from "@/types/filetag";
import type { Recording } from "@/types/recording";

interface Props {
    recording: Recording;
    /** Resolved playback duration in seconds (0 when not yet loaded). */
    duration: number;
    /** Directory the recording belongs to, resolved by the Workstation. */
    filetag?: Filetag | null;
    scrubberStyle: "waveform" | "slider";
    waveformStatus: "idle" | "ready" | "decoding" | "skipped" | "error";
    onDecodeWaveform: () => void;
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
    filetag,
    scrubberStyle,
    waveformStatus,
    onDecodeWaveform,
}: Props) {
    const metaParts: string[] = [
        formatDateTime(recording.startTime, "relative"),
        formatDuration(duration || recording.duration / 1000),
        formatBytes(recording.filesize),
    ];
    const FiletagIcon = filetag ? getFiletagIcon(filetag.icon) : null;

    return (
        <CardHeader className="gap-1">
            <CardTitle className="truncate text-lg">
                {recording.filename}
            </CardTitle>
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
                {filetag && FiletagIcon && (
                    <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true" className="opacity-40">
                            ·
                        </span>
                        <span
                            className="inline-flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.5"
                            style={{ color: filetag.color }}
                        >
                            <FiletagIcon className="size-3 shrink-0" />
                            <span className="truncate">{filetag.name}</span>
                        </span>
                    </span>
                )}
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
