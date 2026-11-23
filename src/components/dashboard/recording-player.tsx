"use client";

import { type Ref, useImperativeHandle } from "react";
import {
    RecordingPlayerControls,
    SKIP_SECONDS,
} from "@/components/dashboard/recording-player-controls";
import type { PlayerPreferences } from "@/components/recording/types";
import { usePlaybackEngine } from "@/hooks/use-playback-engine";
import { usePlaybackKeyboard } from "@/hooks/use-playback-keyboard";
import { useWaveform } from "@/hooks/use-waveform";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

/** What the reader can ask of the player (transcript timestamps). */
export interface RecordingPlayerHandle {
    /** Seek to `seconds` and start playing. */
    playFrom: (seconds: number) => void;
}

interface RecordingPlayerProps extends PlayerPreferences {
    recording: Recording;
    /** Called when playback ends and auto-play-next is on. */
    onEnded?: () => void;
    /** Receives the player's handle, for play-from-here elsewhere. */
    controlRef?: Ref<RecordingPlayerHandle>;
    className?: string;
}

/**
 * Night player bar for a single recording. State is owned by
 * usePlaybackEngine (audio element + transport state); keyboard
 * shortcuts by usePlaybackKeyboard; waveform peaks by useWaveform.
 * This component is the composition root + the hidden <audio> element
 * the engine writes to. Placement (floating or docked) is the parent's.
 *
 * `scrubberStyle`: `"slider"` always renders a slider; `"waveform"`
 * renders the dot waveform (flat until peaks are decoded).
 */
export function RecordingPlayer({
    recording,
    onEnded,
    initialPlaybackSpeed = 1.0,
    initialVolume = 75,
    initialAutoPlayNext = false,
    scrubberStyle = "waveform",
    controlRef,
    className,
}: RecordingPlayerProps) {
    const {
        audioRef,
        isPlaying,
        currentTime,
        duration,
        volume,
        setVolume,
        playbackSpeed,
        togglePlayPause,
        playFrom,
        seekToRatio,
        seekRelative,
        cycleSpeed,
        toggleMute,
    } = usePlaybackEngine({
        recording,
        onEnded,
        initialPlaybackSpeed,
        initialVolume,
        initialAutoPlayNext,
    });

    useImperativeHandle(controlRef, () => ({ playFrom }), [playFrom]);

    // Arrow keys take the same step as the skip buttons.
    usePlaybackKeyboard({
        onToggle: togglePlayPause,
        onSkip: (direction) => seekRelative(direction * SKIP_SECONDS),
        onVolumeDelta: (delta) =>
            setVolume((prev) => Math.max(0, Math.min(100, prev + delta))),
    });

    // Waveform peaks: cached server-side if present, decoded client-side
    // on first listen for recordings under AUTO_DECODE_MAX_MS. Longer
    // recordings wait for the "Generate waveform" button so we don't
    // surprise the user with a multi-hundred-MB decode.
    const {
        peaks: waveformPeaks,
        status: waveformStatus,
        decode: triggerWaveformDecode,
    } = useWaveform({
        recordingId: recording.id,
        durationMs: recording.duration,
        initialPeaks: recording.waveformPeaks ?? null,
        autoStart: scrubberStyle === "waveform",
    });

    return (
        <section
            aria-label="Player"
            className={cn(
                "squircle rounded-[var(--radius-card)] bg-player py-1.5 pr-4 pl-1.5 shadow-player lg:py-2.5 lg:pr-3.5 lg:pl-2.5",
                className,
            )}
        >
            <RecordingPlayerControls
                isPlaying={isPlaying}
                onTogglePlay={togglePlayPause}
                currentTime={currentTime}
                // Fall back to the stored length until the audio element
                // reports its own, so the total never flashes 0:00.
                duration={duration || recording.duration / 1000}
                onSeekRatio={seekToRatio}
                onSkip={seekRelative}
                playbackSpeed={playbackSpeed}
                onCycleSpeed={cycleSpeed}
                volume={volume}
                onVolumeChange={setVolume}
                onToggleMute={toggleMute}
                scrubberStyle={scrubberStyle}
                waveformPeaks={waveformPeaks}
                waveformStatus={waveformStatus}
                onDecodeWaveform={triggerWaveformDecode}
            />
            <audio ref={audioRef} preload="metadata" className="hidden">
                <track kind="captions" />
            </audio>
        </section>
    );
}
