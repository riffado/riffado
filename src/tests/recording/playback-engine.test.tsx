/**
 * @vitest-environment jsdom
 *
 * Player state follows the audio element (H2): the button shows Pause only
 * after the element reports `play`, a failed play() returns to Play, and
 * the toast says what happened with Try again (plus Download when the file
 * itself didn't load).
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: { error: toastError } }));

import { usePlaybackEngine } from "@/hooks/use-playback-engine";
import type { Recording } from "@/types/recording";

let engine: ReturnType<typeof usePlaybackEngine> | null = null;

function Player() {
    engine = usePlaybackEngine({ recording: { id: "rec-1" } as Recording });
    return (
        <audio ref={engine.audioRef}>
            <track kind="captions" />
        </audio>
    );
}

function audio(): HTMLAudioElement {
    const el = engine?.audioRef.current;
    if (!el) throw new Error("audio element not mounted");
    return el;
}

beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    toastError.mockReset();
    engine = null;
});

describe("usePlaybackEngine play state", () => {
    it("shows playing only once the element reports it", () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
            async () => {},
        );
        render(<Player />);

        act(() => engine?.togglePlayPause());
        expect(engine?.isPlaying).toBe(false);

        act(() => {
            audio().dispatchEvent(new Event("play"));
        });
        expect(engine?.isPlaying).toBe(true);

        act(() => {
            audio().dispatchEvent(new Event("pause"));
        });
        expect(engine?.isPlaying).toBe(false);
    });

    it("returns to Play and offers Try again and Download when play() fails", async () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
            new DOMException("no supported sources", "NotSupportedError"),
        );
        render(<Player />);

        await act(async () => {
            engine?.togglePlayPause();
        });

        expect(engine?.isPlaying).toBe(false);
        expect(toastError).toHaveBeenCalledTimes(1);
        const [title, options] = toastError.mock.calls[0];
        expect(title).toBe("Couldn't play this recording");
        expect(options.action.label).toBe("Try again");
        expect(options.secondary.label).toBe("Download");
    });

    it("ignores a play() interrupted by a source reload", async () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
            new DOMException("interrupted by a new load request", "AbortError"),
        );
        render(<Player />);

        await act(async () => {
            engine?.togglePlayPause();
        });

        expect(toastError).not.toHaveBeenCalled();
    });
});
