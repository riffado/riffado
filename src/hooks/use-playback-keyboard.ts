"use client";

import { useEffect } from "react";

interface Options {
    onToggle: () => void;
    /** Skip one step back (-1) or forward (1); the player decides the size. */
    onSkip: (direction: -1 | 1) => void;
    onVolumeDelta: (delta: number) => void;
}

/**
 * Global keyboard shortcuts for the recording player.
 *
 * Space     -> play/pause
 * ArrowLeft -> skip back one step (same as the player's skip button)
 * ArrowRight-> skip forward one step
 * ArrowUp   -> volume +5
 * ArrowDown -> volume -5
 *
 * Skipped while the user is typing in an input/textarea/contentEditable
 * so the shortcuts don't fight form fields. Listener attaches once and
 * delegates to the supplied callbacks -- the engine hook owns the
 * actual state mutations so this hook stays purely about key->intent
 * mapping.
 */
export function usePlaybackKeyboard({
    onToggle,
    onSkip,
    onVolumeDelta,
}: Options) {
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
                case " ":
                    e.preventDefault();
                    onToggle();
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    onSkip(-1);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    onSkip(1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    onVolumeDelta(5);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    onVolumeDelta(-5);
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onToggle, onSkip, onVolumeDelta]);
}
