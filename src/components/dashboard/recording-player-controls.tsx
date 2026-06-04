"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Waveform } from "@/components/dashboard/waveform";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PLAYBACK_SPEED_OPTIONS } from "@/hooks/use-playback-engine";
import { formatTimeLike } from "@/lib/format-duration";

interface Props {
    isPlaying: boolean;
    onTogglePlay: () => void;
    currentTime: number;
    duration: number;
    onSeekRatio: (ratio: number) => void;
    playbackSpeed: number;
    onCycleSpeed: () => void;
    volume: number;
    onVolumeChange: (volume: number) => void;
    onToggleMute: () => void;
    scrubberStyle: "waveform" | "slider";
    waveformPeaks: number[] | null;
}

/**
 * Controls row for the recording player: play/pause, time label,
 * scrubber (waveform when peaks are decoded, slider otherwise), speed
 * cycle button, and volume slider with a mute toggle.
 *
 * Pure presentation -- all state lives in usePlaybackEngine, and the
 * parent wires this component's callbacks to that hook's handlers.
 */
export function RecordingPlayerControls({
    isPlaying,
    onTogglePlay,
    currentTime,
    duration,
    onSeekRatio,
    playbackSpeed,
    onCycleSpeed,
    volume,
    onVolumeChange,
    onToggleMute,
    scrubberStyle,
    waveformPeaks,
}: Props) {
    const seekDisabled = !duration || duration === 0;
    const seekRatio = duration > 0 ? currentTime / duration : 0;
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const speedLabel =
        PLAYBACK_SPEED_OPTIONS.find((opt) => opt.value === playbackSpeed)
            ?.label || "1x";
    const speakerIcon =
        volume === 0 ? (
            <VolumeX className="size-4" />
        ) : (
            <Volume2 className="size-4" />
        );

    return (
        <div className="flex items-center gap-4">
            <Button
                onClick={onTogglePlay}
                size="lg"
                variant="glow"
                aria-label={isPlaying ? "Pause" : "Play"}
                className="size-11 shrink-0 rounded-full"
            >
                {isPlaying ? (
                    <Pause className="size-5" />
                ) : (
                    <Play className="size-5" />
                )}
            </Button>

            {/*
              Fixed-width time label, monospace + tabular-nums so digit
              width is stable, and `formatTimeLike` pads currentTime to
              match duration's segment structure so the whole
              `M:SS / H:MM:SS` line never resizes mid-playback. Sits
              next to play so the eye can pair them without scanning.
            */}
            <span
                className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                aria-live="off"
            >
                <span className="text-foreground">
                    {formatTimeLike(currentTime, duration)}
                </span>
                <span className="mx-1 opacity-40">/</span>
                <span>{formatTimeLike(duration, duration)}</span>
            </span>

            {/*
              Waveform takes whatever's left, with min-w-0 so flex
              doesn't expand the parent when bars are dense.
            */}
            <div className="min-w-0 flex-1">
                {scrubberStyle === "waveform" && waveformPeaks ? (
                    <Waveform
                        peaks={waveformPeaks}
                        progress={seekRatio}
                        durationSeconds={duration}
                        onSeek={onSeekRatio}
                        disabled={seekDisabled}
                        height={56}
                    />
                ) : (
                    <Slider
                        value={[progress]}
                        onValueChange={(value) =>
                            onSeekRatio((value[0] ?? 0) / 100)
                        }
                        onValueCommit={(value) =>
                            onSeekRatio((value[0] ?? 0) / 100)
                        }
                        max={100}
                        step={0.1}
                        className="w-full"
                        disabled={seekDisabled}
                    />
                )}
            </div>

            <Button
                onClick={onCycleSpeed}
                variant="outline"
                size="sm"
                className="h-8 w-12 shrink-0 px-0 font-mono text-xs tabular-nums"
                title="Click to cycle playback speed"
                aria-label={`Playback speed ${speedLabel}. Click to change.`}
            >
                {speedLabel}
            </Button>

            <div className="flex shrink-0 items-center gap-2">
                <button
                    type="button"
                    onClick={onToggleMute}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={volume === 0 ? "Unmute" : "Mute"}
                    title={volume === 0 ? "Unmute" : "Mute"}
                >
                    {speakerIcon}
                </button>
                <Slider
                    value={[volume]}
                    onValueChange={(value) => onVolumeChange(value[0] ?? 75)}
                    max={100}
                    className="w-20"
                    aria-label="Volume"
                />
            </div>
        </div>
    );
}
