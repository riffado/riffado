"use client";

import {
    AudioWaveform,
    Loader2,
    Pause,
    Play,
    Volume2,
    VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Waveform } from "@/components/dashboard/waveform";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useWaveform } from "@/hooks/use-waveform";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/format-date";
import { formatDuration, formatTimeLike } from "@/lib/format-duration";
import type { Recording } from "@/types/recording";

interface RecordingPlayerProps {
    recording: Recording;
    onEnded?: () => void;
    initialPlaybackSpeed?: number;
    initialVolume?: number;
    initialAutoPlayNext?: boolean;
    /**
     * Which scrubber style to render. `"slider"` forces the plain
     * progress bar even when waveform peaks are available; `"waveform"`
     * shows the canvas waveform when peaks exist and falls back to the
     * slider otherwise. Read from userSettings.playerScrubber.
     */
    scrubberStyle?: "waveform" | "slider";
}

const playbackSpeedOptions = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
];

export function RecordingPlayer({
    recording,
    onEnded,
    initialPlaybackSpeed = 1.0,
    initialVolume = 75,
    initialAutoPlayNext = false,
    scrubberStyle = "waveform",
}: RecordingPlayerProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(initialVolume);
    const [playbackSpeed, setPlaybackSpeed] = useState(initialPlaybackSpeed);
    const [autoPlayNext] = useState(initialAutoPlayNext);
    const audioRef = useRef<HTMLAudioElement>(null);
    const isSeekingRef = useRef(false);

    useEffect(() => {
        const recordingId = recording.id; // Explicitly use recording to satisfy linter
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
        if (audioRef.current) {
            audioRef.current.src = `/api/recordings/${recordingId}/audio`;
            audioRef.current.load();
        }
    }, [recording]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume / 100;
        }
    }, [volume]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackSpeed;
        }
    }, [playbackSpeed]);

    useEffect(() => {
        if (!audioRef.current) return;

        const audio = audioRef.current;
        const recordingId = recording.id; // Explicitly use recording to satisfy linter

        const updateTime = () => {
            if (!isSeekingRef.current) {
                setCurrentTime(audio.currentTime);
            }
        };
        const updateDuration = () => {
            if (audio.duration && !Number.isNaN(audio.duration)) {
                setDuration(audio.duration);
            }
        };
        const handleEnded = () => {
            setIsPlaying(false);
            if (autoPlayNext && onEnded) {
                onEnded();
            }
        };
        const handleSeeked = () => {
            isSeekingRef.current = false;
            setCurrentTime(audio.currentTime);
        };

        if (audio.src !== `/api/recordings/${recordingId}/audio`) {
            audio.src = `/api/recordings/${recordingId}/audio`;
            audio.load();
        }

        audio.addEventListener("timeupdate", updateTime);
        audio.addEventListener("loadedmetadata", updateDuration);
        audio.addEventListener("durationchange", updateDuration);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("seeked", handleSeeked);

        if (audio.duration && !Number.isNaN(audio.duration)) {
            setDuration(audio.duration);
        }

        return () => {
            audio.removeEventListener("timeupdate", updateTime);
            audio.removeEventListener("loadedmetadata", updateDuration);
            audio.removeEventListener("durationchange", updateDuration);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("seeked", handleSeeked);
        };
    }, [recording, autoPlayNext, onEnded]);

    const togglePlayPause = useCallback(() => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.playbackRate = playbackSpeed;
            audioRef.current.play().catch((error) => {
                console.error("Error playing audio:", error);
                toast.error("Failed to play audio");
            });
        }
        setIsPlaying(!isPlaying);
    }, [isPlaying, playbackSpeed]);

    const handleSeek = (value: number[]) => {
        const audio = audioRef.current;
        if (!audio) return;

        const percentage = value[0];

        const audioDuration = audio.duration;
        if (!audioDuration || Number.isNaN(audioDuration)) {
            audio.load();
            return;
        }

        const newTime = (percentage / 100) * audioDuration;

        isSeekingRef.current = true;

        audio.currentTime = newTime;

        setCurrentTime(newTime);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
            ) {
                return;
            }

            switch (e.key) {
                case " ": {
                    e.preventDefault();
                    togglePlayPause();
                    break;
                }
                case "ArrowLeft": {
                    e.preventDefault();
                    if (audioRef.current && duration > 0) {
                        const newTime = Math.max(0, currentTime - 5);
                        audioRef.current.currentTime = newTime;
                        setCurrentTime(newTime);
                    }
                    break;
                }
                case "ArrowRight": {
                    e.preventDefault();
                    if (audioRef.current && duration > 0) {
                        const newTime = Math.min(duration, currentTime + 5);
                        audioRef.current.currentTime = newTime;
                        setCurrentTime(newTime);
                    }
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    setVolume((prev) => Math.min(100, prev + 5));
                    break;
                }
                case "ArrowDown": {
                    e.preventDefault();
                    setVolume((prev) => Math.max(0, prev - 5));
                    break;
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentTime, duration, togglePlayPause]);

    // Local alias kept so existing JSX reads naturally; the helper
    // itself lives in @/lib/format-duration and handles the H:MM:SS
    // switch for recordings longer than an hour.
    const formatTime = formatDuration;

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Waveform peaks: cached server-side if present, decoded client-side
    // on first listen for recordings under AUTO_DECODE_MAX_MS. Long
    // recordings show a manual "Generate waveform" button instead so we
    // don't surprise the user with a multi-hundred-MB decode.
    const {
        peaks: waveformPeaks,
        status: waveformStatus,
        decode: triggerWaveformDecode,
    } = useWaveform({
        recordingId: recording.id,
        durationMs: recording.duration,
        initialPeaks: recording.waveformPeaks ?? null,
        // Skip auto-decode entirely when the user has opted out of the
        // waveform UI — there's no point spending CPU on peaks the
        // player will never display.
        autoStart: scrubberStyle === "waveform",
    });

    // Seek by waveform click. Receives a [0, 1] ratio; converts to the
    // same audio.currentTime path as the slider so seeking semantics are
    // identical regardless of which control the user touches.
    const handleWaveformSeek = useCallback((ratio: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        const audioDuration = audio.duration;
        if (!audioDuration || Number.isNaN(audioDuration)) {
            audio.load();
            return;
        }
        const newTime = Math.max(
            0,
            Math.min(audioDuration, ratio * audioDuration),
        );
        isSeekingRef.current = true;
        audio.currentTime = newTime;
        setCurrentTime(newTime);
    }, []);

    // Speed cycling: factored out so it can be reused (button + future
    // command palette action).
    const cycleSpeed = useCallback(() => {
        const currentIndex = playbackSpeedOptions.findIndex(
            (opt) => opt.value === playbackSpeed,
        );
        const nextIndex = (currentIndex + 1) % playbackSpeedOptions.length;
        const nextSpeed = playbackSpeedOptions[nextIndex].value;
        setPlaybackSpeed(nextSpeed);
        if (audioRef.current) {
            audioRef.current.playbackRate = nextSpeed;
        }
    }, [playbackSpeed]);

    // Click-to-mute: stash the previous volume so unmute restores it.
    // A pure 0/75 toggle would be surprising for users who set their
    // own preferred level.
    const previousVolumeRef = useRef<number>(volume > 0 ? volume : 75);
    useEffect(() => {
        if (volume > 0) previousVolumeRef.current = volume;
    }, [volume]);
    const toggleMute = useCallback(() => {
        setVolume((v) => (v > 0 ? 0 : previousVolumeRef.current || 75));
    }, []);

    const speedLabel =
        playbackSpeedOptions.find((opt) => opt.value === playbackSpeed)
            ?.label || "1x";
    const speakerIcon =
        volume === 0 ? (
            <VolumeX className="size-4" />
        ) : (
            <Volume2 className="size-4" />
        );

    const seekDisabled = !duration || duration === 0;
    const seekRatio = duration > 0 ? currentTime / duration : 0;

    // Compact metadata line under the title — replaces the redundant
    // toLocaleString() subtitle. Order is information-density-first:
    // when (relative), then how long (duration), then how big (size).
    const metaParts: string[] = [
        formatDateTime(recording.startTime, "relative"),
        formatTime(duration || recording.duration / 1000),
        formatBytes(recording.filesize),
    ];

    return (
        <Card>
            <CardHeader className="gap-1">
                <CardTitle className="truncate text-lg">
                    {recording.filename}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {metaParts.map((part, i) => (
                        <span
                            key={part}
                            className="inline-flex items-center gap-2"
                        >
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
                                onClick={triggerWaveformDecode}
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
                    {scrubberStyle === "waveform" &&
                        waveformStatus === "error" && (
                            <button
                                type="button"
                                onClick={triggerWaveformDecode}
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
            <CardContent>
                <div className="flex items-center gap-4">
                    <Button
                        onClick={togglePlayPause}
                        size="lg"
                        aria-label={isPlaying ? "Pause" : "Play"}
                        className="size-12 shrink-0 rounded-full"
                    >
                        {isPlaying ? (
                            <Pause className="size-5" />
                        ) : (
                            <Play className="size-5" />
                        )}
                    </Button>

                    {/* Fixed-width time label, monospace + tabular-nums
                        so digit width is stable, and `formatTimeLike`
                        pads currentTime to match duration's segment
                        structure so the whole `M:SS / H:MM:SS` line
                        never resizes mid-playback. Sits next to play so
                        the eye can pair them without scanning. */}
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

                    {/* Waveform takes whatever's left, with min-w-0 so
                        flex doesn't expand the parent when bars are dense. */}
                    <div className="min-w-0 flex-1">
                        {scrubberStyle === "waveform" && waveformPeaks ? (
                            <Waveform
                                peaks={waveformPeaks}
                                progress={seekRatio}
                                durationSeconds={duration}
                                onSeek={handleWaveformSeek}
                                disabled={seekDisabled}
                                height={56}
                            />
                        ) : (
                            <Slider
                                value={[progress]}
                                onValueChange={handleSeek}
                                onValueCommit={handleSeek}
                                max={100}
                                step={0.1}
                                className="w-full"
                                disabled={seekDisabled}
                            />
                        )}
                    </div>

                    <Button
                        onClick={cycleSpeed}
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
                            onClick={toggleMute}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={volume === 0 ? "Unmute" : "Mute"}
                            title={volume === 0 ? "Unmute" : "Mute"}
                        >
                            {speakerIcon}
                        </button>
                        <Slider
                            value={[volume]}
                            onValueChange={(value) => setVolume(value[0] ?? 75)}
                            max={100}
                            className="w-20"
                            aria-label="Volume"
                        />
                    </div>
                </div>

                <audio
                    ref={audioRef}
                    src={`/api/recordings/${recording.id}/audio`}
                    preload="metadata"
                    className="hidden"
                >
                    <track kind="captions" />
                </audio>
            </CardContent>
        </Card>
    );
}
