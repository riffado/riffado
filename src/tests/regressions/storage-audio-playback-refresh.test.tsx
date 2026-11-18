/**
 * @vitest-environment jsdom
 *
 * Regression: in-app playback when the presigned storage URL fails.
 *
 * In-app playback is redirected to a short-lived storage URL. Two things
 * break that:
 *   1. The browser cannot reach the storage endpoint at all (self-hosted
 *      MinIO on the Docker network, an http endpoint behind an https
 *      app). The redirected source never loads. The player now switches
 *      to `?stream=1` (always streamed by the app) on the first media
 *      error, and once a streamed source has loaded, keeps using stream
 *      mode for the rest of the browser session.
 *   2. The presigned URL expires mid-session. Chrome sends later Range
 *      requests (seeks) straight to the redirect target, so a seek fails.
 *      The player re-requests the app URL (a fresh storage URL) and only
 *      falls back to streaming if that refreshed source fails too.
 * Position and play state are restored after either reload.
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

function fire(audio: HTMLAudioElement, type: "error" | "loadedmetadata") {
    act(() => {
        audio.dispatchEvent(new Event(type));
    });
}

describe("usePlaybackEngine source fallback", () => {
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
        window.sessionStorage.clear();
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
        window.sessionStorage.clear();
        engine = null;
    });

    it("switches to the streamed source as soon as the redirected source fails to load", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        expect(audio.getAttribute("src")).toBe("/api/recordings/rec-1/audio");
        load.mockClear();

        fire(audio, "error");

        expect(audio.getAttribute("src")).toBe(
            "/api/recordings/rec-1/audio?stream=1",
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("restores position and playback on the streamed source", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        act(() => {
            engine?.togglePlayPause();
        });
        play.mockClear();
        currentTime = 312;

        fire(audio, "error");
        currentTime = 0;
        fire(audio, "loadedmetadata");

        expect(currentTime).toBe(312);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it("uses the streamed source for later loads once streaming worked", () => {
        const view = render(
            <Player recording={{ id: "rec-1" } as Recording} />,
        );
        const audio = audioElement();
        fire(audio, "error");
        fire(audio, "loadedmetadata");

        view.rerender(<Player recording={{ id: "rec-2" } as Recording} />);
        expect(audioElement().getAttribute("src")).toBe(
            "/api/recordings/rec-2/audio?stream=1",
        );

        view.unmount();
        render(<Player recording={{ id: "rec-3" } as Recording} />);
        expect(audioElement().getAttribute("src")).toBe(
            "/api/recordings/rec-3/audio?stream=1",
        );
    });

    it("does not remember stream mode when the streamed source never loaded", () => {
        const view = render(
            <Player recording={{ id: "rec-1" } as Recording} />,
        );
        fire(audioElement(), "error");
        view.unmount();

        render(<Player recording={{ id: "rec-2" } as Recording} />);
        expect(audioElement().getAttribute("src")).toBe(
            "/api/recordings/rec-2/audio",
        );
    });

    it("does not loop once the streamed source fails too", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        load.mockClear();

        fire(audio, "error");
        fire(audio, "error");
        vi.advanceTimersByTime(31_000);
        fire(audio, "error");

        expect(load).toHaveBeenCalledTimes(1);
        expect(audio.getAttribute("src")).toBe(
            "/api/recordings/rec-1/audio?stream=1",
        );
    });

    it("refreshes an expired storage URL through the app before falling back to streaming", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        fire(audio, "loadedmetadata");
        act(() => {
            engine?.togglePlayPause();
        });
        load.mockClear();
        play.mockClear();
        currentTime = 754;

        fire(audio, "error");

        expect(audio.getAttribute("src")).toBe("/api/recordings/rec-1/audio");
        expect(load).toHaveBeenCalledTimes(1);

        currentTime = 0;
        fire(audio, "loadedmetadata");
        expect(currentTime).toBe(754);
        expect(play).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(31_000);
        fire(audio, "error");
        expect(audio.getAttribute("src")).toBe("/api/recordings/rec-1/audio");
        expect(load).toHaveBeenCalledTimes(2);

        fire(audio, "error");
        expect(audio.getAttribute("src")).toBe(
            "/api/recordings/rec-1/audio?stream=1",
        );
        expect(load).toHaveBeenCalledTimes(3);
    });

    it("falls back to streaming when a refreshed source fails again within the cooldown", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        fire(audio, "loadedmetadata");
        fire(audio, "error");
        fire(audio, "loadedmetadata");

        fire(audio, "error");

        expect(audio.getAttribute("src")).toBe(
            "/api/recordings/rec-1/audio?stream=1",
        );
    });

    it("does not resume playback that was paused", () => {
        render(<Player recording={{ id: "rec-1" } as Recording} />);
        const audio = audioElement();
        currentTime = 30;

        fire(audio, "error");
        fire(audio, "loadedmetadata");

        expect(currentTime).toBe(30);
        expect(play).not.toHaveBeenCalled();
    });
});
