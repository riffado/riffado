"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Recording } from "@/types/recording";

export const PLAYBACK_SPEED_OPTIONS = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2x", value: 2.0 },
] as const;

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

    // Reset transport state and re-point src whenever the recording
    // changes. The src swap is duplicated in the listener-wiring
    // effect below for the case where the element wasn't mounted yet
    // when this effect ran -- both branches guard with the `audio.src
    // !==` check so the swap is idempotent.
    useEffect(() => {
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.src = `/api/recordings/${recording.id}/audio`;
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

    // Listener wiring. Re-runs whenever the recording changes (so the
    // ended handler closes over the right onEnded / autoPlayNext) but
    // the listener identities themselves are stable within a single
    // mount of the recording.
    useEffect(() => {
        if (!audioRef.current) return;
        const audio = audioRef.current;
        const recordingId = recording.id;

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
        // Derive isPlaying from the element's own events rather than optimistically
        // toggling it on click — this keeps the rAF playhead loop below in exact
        // sync with whether audio is actually advancing (e.g. if play() rejects,
        // or the OS pauses us, isPlaying still reflects reality).
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        if (audio.src !== `/api/recordings/${recordingId}/audio`) {
            audio.src = `/api/recordings/${recordingId}/audio`;
            audio.load();
        }

        // timeupdate is kept as a coarse fallback (it still fires in background
        // tabs, where requestAnimationFrame is throttled); the rAF loop below
        // does the smooth 60fps work while the tab is visible and playing.
        audio.addEventListener("timeupdate", updateTime);
        audio.addEventListener("loadedmetadata", updateDuration);
        audio.addEventListener("durationchange", updateDuration);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("seeked", handleSeeked);
        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);

        if (audio.duration && !Number.isNaN(audio.duration)) {
            setDuration(audio.duration);
        }

        return () => {
            audio.removeEventListener("timeupdate", updateTime);
            audio.removeEventListener("loadedmetadata", updateDuration);
            audio.removeEventListener("durationchange", updateDuration);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("seeked", handleSeeked);
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
        };
    }, [recording, autoPlayNext, onEnded]);

    // Smooth playhead. The HTMLMediaElement `timeupdate` event only fires about
    // 4x/second, so a playhead/slider driven by it visibly stutters and lags the
    // audio — it never lands "in line" with where the sound actually is. While
    // playing, sample audio.currentTime once per animation frame (~60fps) so the
    // waveform playhead glides exactly with playback. The loop only runs while
    // playing, so it costs nothing when paused.
    useEffect(() => {
        if (!isPlaying) return;
        const audio = audioRef.current;
        if (!audio) return;
        let raf = 0;
        const tick = () => {
            if (!isSeekingRef.current) setCurrentTime(audio.currentTime);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isPlaying]);

    const togglePlayPause = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        // Use the element's own paused flag as the source of truth and let the
        // play/pause listeners flip isPlaying — no optimistic toggle that can
        // desync from reality (e.g. when play() rejects on a stale src).
        if (audio.paused) {
            audio.playbackRate = playbackSpeed;
            audio.play().catch((error) => {
                console.error("Error playing audio:", error);
                toast.error("Failed to play audio");
            });
        } else {
            audio.pause();
        }
    }, [playbackSpeed]);

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
