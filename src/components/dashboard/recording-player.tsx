"use client";

import { RecordingPlayerControls } from "@/components/dashboard/recording-player-controls";
import { RecordingPlayerHeader } from "@/components/dashboard/recording-player-header";
import { Card, CardContent } from "@/components/ui/card";
import { usePlaybackEngine } from "@/hooks/use-playback-engine";
import { usePlaybackKeyboard } from "@/hooks/use-playback-keyboard";
import { useWaveform } from "@/hooks/use-waveform";
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
    /** Called after the user successfully renames the recording. */
    onTitleChange?: (newTitle: string) => void;
}

/**
 * Audio playback card for a single recording. State is owned by
 * usePlaybackEngine (audio element + transport state); keyboard
 * shortcuts by usePlaybackKeyboard; waveform peaks by useWaveform.
 * This component is the composition root + the hidden <audio>
 * element that the engine writes to.
 */
export function RecordingPlayer({
    recording,
    onEnded,
    initialPlaybackSpeed = 1.0,
    initialVolume = 75,
    initialAutoPlayNext = false,
    scrubberStyle = "waveform",
    onTitleChange,
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

    usePlaybackKeyboard({
        onToggle: togglePlayPause,
        onSeekRelative: seekRelative,
        onVolumeDelta: (delta) =>
            setVolume((prev) => Math.max(0, Math.min(100, prev + delta))),
    });

    // Waveform peaks: cached server-side if present, decoded
    // client-side on first listen for recordings under
    // AUTO_DECODE_MAX_MS. Long recordings show a manual "Generate
    // waveform" button instead so we don't surprise the user with a
    // multi-hundred-MB decode.
    const {
        peaks: waveformPeaks,
        status: waveformStatus,
        decode: triggerWaveformDecode,
    } = useWaveform({
        recordingId: recording.id,
        durationMs: recording.duration,
        initialPeaks: recording.waveformPeaks ?? null,
        // Skip auto-decode entirely when the user has opted out of the
        // waveform UI -- there's no point spending CPU on peaks the
        // player will never display.
        autoStart: scrubberStyle === "waveform",
    });

    return (
        <Card>
            <RecordingPlayerHeader
                recording={recording}
                duration={duration}
                scrubberStyle={scrubberStyle}
                waveformStatus={waveformStatus}
                onDecodeWaveform={triggerWaveformDecode}
                onTitleChange={onTitleChange}
            />
            <CardContent>
                <RecordingPlayerControls
                    isPlaying={isPlaying}
                    onTogglePlay={togglePlayPause}
                    currentTime={currentTime}
                    duration={duration}
                    onSeekRatio={seekToRatio}
                    playbackSpeed={playbackSpeed}
                    onCycleSpeed={cycleSpeed}
                    volume={volume}
                    onVolumeChange={setVolume}
                    onToggleMute={toggleMute}
                    scrubberStyle={scrubberStyle}
                    waveformPeaks={waveformPeaks}
                />

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
