/**
 * @vitest-environment jsdom
 *
 * Regression: playback after a presigned audio URL expires.
 *
 * In-app playback is redirected to a short-lived storage URL. Chrome sends
 * later Range requests (seeks) straight to the redirect target, so once
 * that URL expires a seek fails with a media error. The player now
 * re-requests the app URL once (which issues a fresh storage URL),
 * restores the position, and resumes if it was playing. A second error
 * within the cooldown does not loop.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { usePlaybackEngine } from "@/hooks/use-playback-engine";
import type { Recording } from "@/types/recording";

let engine: ReturnType<typeof usePlaybackEngine> | null = null;

function Player({ recording }: { recording: Recording }) {
    engine = usePlaybackEngine({ recording });
    return (
        <audio ref={engine.audioRef}>
            <track kind="captions" />
        </audio>
    );
}

function audioElement(): HTMLAudioElement {
    const audio = engine?.audioRef.current;
    if (!audio) throw new Error("audio element not mounted");
    return audio;
}

describe("usePlaybackEngine source refresh", () => {
    let load: ReturnType<typeof vi.spyOn>;
    let play: ReturnType<typeof vi.spyOn>;
    let currentTime = 0;
    const originalCurrentTime = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "currentTime",
    );

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
        currentTime = 0;
        load = vi
            .spyOn(HTMLMediaElement.prototype, "load")
            .mockImplementation(() => {});
        play = vi
            .spyOn(HTMLMediaElement.prototype, "play")
            .mockImplementation(async () => {});
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
            () => {},
        );
        Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
            configurable: true,
            get: () => currentTime,
            set: (value: number) => {
                currentTime = value;
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (originalCurrentTime) {
            Object.defineProperty(
                HTMLMediaElement.prototype,
                "currentTime",
                originalCurrentTime,
            );
        }
        engine = null;
    });

    it("re-requests the app URL after a media error, then restores position and playback", async () => {
        const recording = { id: "rec-1" } as Recording;
        render(<Player recording={recording} />);
        const audio = audioElement();

        act(() => {
            engine?.togglePlayPause();
        });
        load.mockClear();
        play.mockClear();
        currentTime = 754;

        act(() => {
            audio.dispatchEvent(new Event("error"));
        });

        expect(audio.getAttribute("src")).toBe("/api/recordings/rec-1/audio");
        expect(load).toHaveBeenCalledTimes(1);

        currentTime = 0;
        act(() => {
            audio.dispatchEvent(new Event("loadedmetadata"));
        });

        expect(currentTime).toBe(754);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it("does not loop when the refreshed source fails again", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        load.mockClear();

        act(() => {
            audio.dispatchEvent(new Event("error"));
            audio.dispatchEvent(new Event("error"));
        });
        expect(load).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(31_000);
        act(() => {
            audio.dispatchEvent(new Event("error"));
        });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("does not resume playback that was paused", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        currentTime = 30;

        act(() => {
            audio.dispatchEvent(new Event("error"));
        });
        act(() => {
            audio.dispatchEvent(new Event("loadedmetadata"));
        });

        expect(currentTime).toBe(30);
        expect(play).not.toHaveBeenCalled();
    });
});
