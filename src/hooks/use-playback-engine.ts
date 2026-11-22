"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordingAudioPlaybackPath } from "@/lib/recordings/filename";
import { toast } from "@/lib/toast";
import type { Recording } from "@/types/recording";

export const PLAYBACK_SPEED_OPTIONS = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
] as const;

const SOURCE_REFRESH_COOLDOWN_MS = 30 * 1000;

const STREAM_MODE_SESSION_KEY = "riffado:audio-stream-mode";

let streamModeWithoutSessionStorage = false;

function isStreamModeEnabled(): boolean {
    try {
        return window.sessionStorage.getItem(STREAM_MODE_SESSION_KEY) === "1";
    } catch {
        return streamModeWithoutSessionStorage;
    }
}

function enableStreamMode(): void {
    streamModeWithoutSessionStorage = true;
    try {
        window.sessionStorage.setItem(STREAM_MODE_SESSION_KEY, "1");
    } catch {}
}

function playbackSource(recordingId: string): string {
    return recordingAudioPlaybackPath(recordingId, {
        stream: isStreamModeEnabled(),
    });
}

interface Options {
    recording: Recording;
    /** Called when audio finishes playing AND autoPlayNext is on. */
    onEnded?: () => void;
    initialPlaybackSpeed?: number;
    initialVolume?: number;
    initialAutoPlayNext?: boolean;
}

/**
 * Owns the HTMLAudioElement and all of its lifecycle: src swap on
 * recording change, listener wiring (timeupdate / loadedmetadata /
 * durationchange / ended / seeked), and the derived playback state
 * (isPlaying, currentTime, duration, volume, playbackSpeed).
 *
 * Returns a stable `audioRef` (attach to a hidden <audio>), the
 * derived state, and imperative handlers (toggle, seek, cycleSpeed,
 * toggleMute). Keyboard bindings live in usePlaybackKeyboard so the
 * test surface for "given an audio element, control playback" stays
 * separate from "given a player UI, react to keys".
 */
export function usePlaybackEngine({
    recording,
    onEnded,
    initialPlaybackSpeed = 1.0,
    initialVolume = 75,
    initialAutoPlayNext = false,
}: Options) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(initialVolume);
    const [playbackSpeed, setPlaybackSpeed] = useState(initialPlaybackSpeed);
    const [autoPlayNext] = useState(initialAutoPlayNext);
    const audioRef = useRef<HTMLAudioElement>(null);
    const isSeekingRef = useRef(false);
    const isPlayingRef = useRef(false);
    const lastSourceRefreshRef = useRef(0);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // Reset transport state and re-point src whenever the recording
    // *id* changes. Filename edits must not remount playback.
    useEffect(() => {
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.src = playbackSource(recording.id);
            audioRef.current.load();
        }
    }, [recording.id]);

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

    // Listener wiring. Re-runs whenever the recording changes (so the
    // ended handler closes over the right onEnded / autoPlayNext) but
    // the listener identities themselves are stable within a single
    // mount of the recording.
    useEffect(() => {
        if (!audioRef.current) return;
        const audio = audioRef.current;
        const recordingId = recording.id;
        const redirectSource = recordingAudioPlaybackPath(recordingId, {
            stream: false,
        });
        const streamSource = recordingAudioPlaybackPath(recordingId, {
            stream: true,
        });
        let sourceLoaded = audio.readyState >= HTMLMediaElement.HAVE_METADATA;

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
        let pendingResumeAt: number | null = null;
        const restorePosition = () => {
            if (pendingResumeAt === null) return;
            audio.currentTime = pendingResumeAt;
            pendingResumeAt = null;
            if (isPlayingRef.current) {
                audio.play().catch(() => setIsPlaying(false));
            }
        };
        const reloadFrom = (source: string) => {
            if (pendingResumeAt === null) {
                pendingResumeAt = audio.currentTime;
            }
            sourceLoaded = false;
            audio.src = source;
            audio.load();
        };
        const handleSourceLoaded = () => {
            sourceLoaded = true;
            if (audio.getAttribute("src") === streamSource) {
                enableStreamMode();
            }
        };
        const handleError = () => {
            if (audio.getAttribute("src") === streamSource) {
                setIsPlaying(false);
                return;
            }
            const now = Date.now();
            const canRefresh =
                sourceLoaded &&
                now - lastSourceRefreshRef.current >=
                    SOURCE_REFRESH_COOLDOWN_MS;
            if (canRefresh) {
                lastSourceRefreshRef.current = now;
                reloadFrom(redirectSource);
                return;
            }
            reloadFrom(streamSource);
        };

        const currentSource = audio.getAttribute("src");
        if (
            currentSource !== redirectSource &&
            currentSource !== streamSource
        ) {
            audio.src = playbackSource(recordingId);
            audio.load();
        }

        audio.addEventListener("timeupdate", updateTime);
        audio.addEventListener("loadedmetadata", handleSourceLoaded);
        audio.addEventListener("loadedmetadata", restorePosition);
        audio.addEventListener("loadedmetadata", updateDuration);
        audio.addEventListener("durationchange", updateDuration);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("seeked", handleSeeked);
        audio.addEventListener("error", handleError);

        if (audio.duration && !Number.isNaN(audio.duration)) {
            setDuration(audio.duration);
        }

        return () => {
            audio.removeEventListener("timeupdate", updateTime);
            audio.removeEventListener("loadedmetadata", handleSourceLoaded);
            audio.removeEventListener("loadedmetadata", restorePosition);
            audio.removeEventListener("loadedmetadata", updateDuration);
            audio.removeEventListener("durationchange", updateDuration);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("seeked", handleSeeked);
            audio.removeEventListener("error", handleError);
        };
    }, [recording.id, autoPlayNext, onEnded]);

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

    /**
     * Seek to a ratio in [0, 1] of the audio's duration. Used by both
     * the slider (which translates 0-100 -> 0-1 itself) and the
     * waveform click handler. Centralising means seek semantics stay
     * identical regardless of which control the user touches.
     */
    const seekToRatio = useCallback((ratio: number) => {
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

    /**
     * Seek by signed seconds offset (used by keyboard left/right).
     * Clamps to [0, duration].
     */
    const seekRelative = useCallback(
        (deltaSeconds: number) => {
            const audio = audioRef.current;
            if (!audio || duration <= 0) return;
            const newTime = Math.max(
                0,
                Math.min(duration, currentTime + deltaSeconds),
            );
            audio.currentTime = newTime;
            setCurrentTime(newTime);
        },
        [currentTime, duration],
    );

    const cycleSpeed = useCallback(() => {
        const currentIndex = PLAYBACK_SPEED_OPTIONS.findIndex(
            (opt) => opt.value === playbackSpeed,
        );
        const nextIndex = (currentIndex + 1) % PLAYBACK_SPEED_OPTIONS.length;
        const nextSpeed = PLAYBACK_SPEED_OPTIONS[nextIndex].value;
        setPlaybackSpeed(nextSpeed);
        if (audioRef.current) {
            audioRef.current.playbackRate = nextSpeed;
        }
    }, [playbackSpeed]);

    // Mute toggle stashes the previous volume so unmute restores it.
    // A pure 0/75 toggle would be surprising for users who set their
    // own preferred level.
    const previousVolumeRef = useRef<number>(volume > 0 ? volume : 75);
    useEffect(() => {
        if (volume > 0) previousVolumeRef.current = volume;
    }, [volume]);
    const toggleMute = useCallback(() => {
        setVolume((v) => (v > 0 ? 0 : previousVolumeRef.current || 75));
    }, []);

    return {
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
    };
}
