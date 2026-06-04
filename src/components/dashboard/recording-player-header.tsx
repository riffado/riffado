"use client";

import { AudioWaveform, Loader2 } from "lucide-react";
import { CardHeader } from "@/components/ui/card";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/format-date";
import { formatDuration } from "@/lib/format-duration";
import type { Recording } from "@/types/recording";

interface Props {
    recording: Recording;
    duration: number;
    scrubberStyle: "waveform" | "slider";
    waveformStatus: "idle" | "ready" | "decoding" | "skipped" | "error";
    onDecodeWaveform: () => void;
}

export function RecordingPlayerHeader({
    recording,
    duration,
    scrubberStyle,
    waveformStatus,
    onDecodeWaveform,
}: Props) {
    const metaParts: string[] = [
        formatDateTime(recording.startTime, "relative"),
        formatDuration(duration || recording.duration / 1000),
        formatBytes(recording.filesize),
    ];

    return (
        <CardHeader className="gap-1.5 pb-4">
            <h2 className="truncate text-base font-semibold leading-tight text-foreground">
                {recording.filename}
            </h2>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground font-mono">
                {metaParts.map((part, i) => (
                    <span
                        key={part}
                        className="inline-flex items-center gap-1.5"
                    >
                        {i > 0 && (
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                        )}
                        <span>{part}</span>
                    </span>
                ))}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "decoding" && (
                        <span className="inline-flex items-center gap-1 text-primary/70">
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                            <Loader2 className="size-2.5 animate-spin" />
                            Analyzing…
                        </span>
                    )}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "skipped" && (
                        <button
                            type="button"
                            onClick={onDecodeWaveform}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                            title="Decode waveform in your browser"
                        >
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                            <AudioWaveform className="size-2.5" />
                            Generate waveform
                        </button>
                    )}
                {scrubberStyle === "waveform" && waveformStatus === "error" && (
                    <button
                        type="button"
                        onClick={onDecodeWaveform}
                        className="inline-flex items-center gap-1 text-destructive hover:underline underline-offset-2 transition-colors"
                    >
                        <span aria-hidden="true" className="opacity-30">
                            ·
                        </span>
                        <AudioWaveform className="size-2.5" />
                        Retry waveform
                    </button>
                )}
            </div>
        </CardHeader>
    );
}
