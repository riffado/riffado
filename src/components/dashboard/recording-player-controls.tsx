"use client";

import {
    AudioWaveform,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
    type KeyboardEvent,
    type PointerEvent,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";
import { NightSlider } from "@/components/recording/night-slider";
import { DotWaveform } from "@/components/ui/dot-waveform";
import { Slider } from "@/components/ui/slider";
import { formatTimeLike } from "@/lib/format-duration";
import { cn } from "@/lib/utils";

/** Seconds the skip buttons jump. Arrow keys still seek 5 s. */
export const SKIP_SECONDS = 10;

type WaveformStatus = "idle" | "ready" | "decoding" | "skipped" | "error";

interface Props {
    isPlaying: boolean;
    onTogglePlay: () => void;
    currentTime: number;
    duration: number;
    onSeekRatio: (ratio: number) => void;
    onSkip: (deltaSeconds: number) => void;
    playbackSpeed: number;
    onCycleSpeed: () => void;
    volume: number;
    onVolumeChange: (volume: number) => void;
    onToggleMute: () => void;
    scrubberStyle: "waveform" | "slider";
    waveformPeaks: number[] | null;
    waveformStatus: WaveformStatus;
    onDecodeWaveform: () => void;
}

/**
 * The night player bar: terracotta play/pause, skip back/forward, the
 * current time, the scrubber (dot waveform, or a slider when the user
 * picked "slider"), total time, speed and volume.
 *
 * Pure presentation: state lives in usePlaybackEngine and the parent
 * wires the callbacks. Arrow keys and Space are handled globally by
 * usePlaybackKeyboard, so the scrubber only adds Home/End.
 */
export function RecordingPlayerControls({
    isPlaying,
    onTogglePlay,
    currentTime,
    duration,
    onSeekRatio,
    onSkip,
    playbackSpeed,
    onCycleSpeed,
    volume,
    onVolumeChange,
    onToggleMute,
    scrubberStyle,
    waveformPeaks,
    waveformStatus,
    onDecodeWaveform,
}: Props) {
    const seekDisabled = !duration;
    const ratio = duration > 0 ? currentTime / duration : 0;
    const canGenerateWaveform =
        scrubberStyle === "waveform" &&
        (waveformStatus === "skipped" || waveformStatus === "error");

    return (
        <div className="flex items-center gap-3 lg:gap-3.5">
            <button
                type="button"
                onClick={onTogglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex size-11.5 shrink-0 items-center justify-center rounded-full bg-terracotta-bright text-night-foreground outline-none transition-transform duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-terracotta-bright/40 active:scale-[0.96] lg:size-12"
            >
                {isPlaying ? (
                    <Pause className="size-4 fill-current" strokeWidth={0} />
                ) : (
                    <Play
                        className="ml-0.5 size-4 fill-current"
                        strokeWidth={0}
                    />
                )}
            </button>

            <NightIconButton
                label={`Back ${SKIP_SECONDS} seconds`}
                onClick={() => onSkip(-SKIP_SECONDS)}
                disabled={seekDisabled}
                className="max-sm:hidden"
            >
                <RotateCcw className="size-5" strokeWidth={1.8} />
            </NightIconButton>
            <NightIconButton
                label={`Forward ${SKIP_SECONDS} seconds`}
                onClick={() => onSkip(SKIP_SECONDS)}
                disabled={seekDisabled}
                className="max-sm:hidden"
            >
                <RotateCw className="size-5" strokeWidth={1.8} />
            </NightIconButton>

            <span
                className="shrink-0 text-small font-medium tabular-nums text-night-foreground"
                aria-live="off"
            >
                {formatTimeLike(currentTime, duration)}
            </span>

            <div className="relative min-w-0 flex-1">
                {scrubberStyle === "slider" ? (
                    <NightSlider
                        value={[ratio * 100]}
                        onValueChange={(value) =>
                            onSeekRatio((value[0] ?? 0) / 100)
                        }
                        max={100}
                        step={0.1}
                        disabled={seekDisabled}
                        aria-label="Seek"
                    />
                ) : (
                    <DotScrubber
                        peaks={waveformPeaks ?? []}
                        ratio={ratio}
                        currentTime={currentTime}
                        duration={duration}
                        disabled={seekDisabled}
                        busy={waveformStatus === "decoding"}
                        onSeekRatio={onSeekRatio}
                    />
                )}
            </div>

            <span className="shrink-0 text-small tabular-nums text-night-text">
                {formatTimeLike(duration, duration)}
            </span>

            {canGenerateWaveform ? (
                <NightIconButton
                    label={
                        waveformStatus === "error"
                            ? "Retry waveform"
                            : "Generate waveform"
                    }
                    onClick={onDecodeWaveform}
                    className="max-sm:hidden"
                >
                    <AudioWaveform className="size-4" strokeWidth={1.8} />
                </NightIconButton>
            ) : null}

            <button
                type="button"
                onClick={onCycleSpeed}
                aria-label={`Playback speed ${formatSpeed(playbackSpeed)}. Click to change.`}
                className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums text-night-text outline-none transition-colors hover:text-night-foreground focus-visible:ring-[3px] focus-visible:ring-night-text/40"
            >
                {formatSpeed(playbackSpeed)}
            </button>

            <VolumeControl
                volume={volume}
                onVolumeChange={onVolumeChange}
                onToggleMute={onToggleMute}
            />
        </div>
    );
}

function formatSpeed(speed: number): string {
    return `${speed}×`;
}

function NightIconButton({
    label,
    onClick,
    disabled,
    className,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-night-text outline-none transition-[color,transform] duration-150 ease-out hover:text-night-foreground focus-visible:ring-[3px] focus-visible:ring-night-text/40 active:scale-[0.96] disabled:opacity-40",
                className,
            )}
        >
            {children}
        </button>
    );
}

/** DotWaveform draws 7 rows on a 6-unit grid, so a column is height / 7 wide. */
const DOT_ROWS = 7;

/**
 * Seekable dot waveform. Reports itself as a slider; click or drag to
 * seek. Columns follow the measured width so the dots fill the bar.
 */
function DotScrubber({
    peaks,
    ratio,
    currentTime,
    duration,
    disabled,
    busy,
    onSeekRatio,
}: {
    peaks: number[];
    ratio: number;
    currentTime: number;
    duration: number;
    disabled: boolean;
    busy: boolean;
    onSeekRatio: (ratio: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [columns, setColumns] = useState(60);

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => {
            const width = entry?.contentRect.width ?? 0;
            const height = entry?.contentRect.height ?? 0;
            if (width > 0 && height > 0) {
                setColumns(
                    Math.max(12, Math.floor((width * DOT_ROWS) / height)),
                );
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        onSeekRatio(
            Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        );
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Home") {
            e.preventDefault();
            onSeekRatio(0);
        } else if (e.key === "End") {
            e.preventDefault();
            onSeekRatio(1);
        }
    };

    return (
        <div
            ref={ref}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTimeLike(currentTime, duration)} of ${formatTimeLike(duration, duration)}`}
            aria-disabled={disabled || undefined}
            aria-busy={busy || undefined}
            data-testid="player-scrubber"
            onPointerDown={(e) => {
                if (disabled) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                seekFromPointer(e);
            }}
            onPointerMove={(e) => {
                if (
                    disabled ||
                    !e.currentTarget.hasPointerCapture(e.pointerId)
                ) {
                    return;
                }
                seekFromPointer(e);
            }}
            onKeyDown={onKeyDown}
            className={cn(
                "rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-night-text/40",
                disabled ? "cursor-default" : "cursor-pointer",
            )}
        >
            <DotWaveform
                peaks={peaks}
                progress={ratio}
                columns={columns}
                tone="night"
                className="h-7 lg:h-9"
            />
        </div>
    );
}

function VolumeControl({
    volume,
    onVolumeChange,
    onToggleMute,
}: {
    volume: number;
    onVolumeChange: (volume: number) => void;
    onToggleMute: () => void;
}) {
    const muted = volume === 0;
    const Icon = muted ? VolumeX : Volume2;
    return (
        <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger asChild>
                <button
                    type="button"
                    aria-label="Volume"
                    title="Volume"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-night-text outline-none transition-colors hover:text-night-foreground focus-visible:ring-[3px] focus-visible:ring-night-text/40 max-lg:hidden"
                >
                    <Icon className="size-4" strokeWidth={1.8} />
                </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    side="top"
                    align="end"
                    sideOffset={14}
                    collisionPadding={12}
                    className="squircle z-50 flex w-48 origin-(--radix-popover-content-transform-origin) items-center gap-3 rounded-[var(--radius-control)] border border-border bg-popover p-3 text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                >
                    <button
                        type="button"
                        onClick={onToggleMute}
                        aria-label={muted ? "Unmute" : "Mute"}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-subtle outline-none transition-colors hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        <Icon className="size-4" />
                    </button>
                    <Slider
                        value={[volume]}
                        onValueChange={(value) =>
                            onVolumeChange(value[0] ?? 75)
                        }
                        max={100}
                        aria-label="Volume"
                    />
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
}
