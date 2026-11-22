/**
 * Toast behaviour from `@/lib/toast`: errors without a button close on
 * their own, errors with one stay; and the "Notification sound" setting,
 * where only errors and newly synced recordings make a sound.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const ding = vi.hoisted(() => ({
    chime: vi.fn(),
    configure: vi.fn(),
    error: vi.fn(),
}));

vi.mock("@yusufceng1z/ding", () => ({ chime: ding.chime }));
vi.mock("@yusufceng1z/ding-react", () => ({
    toast: { configure: ding.configure, error: ding.error },
}));

import { chimeNewRecordings, setToastSound, toast } from "@/lib/toast";

type SoundOption = false | ((type: string) => void);

function configuredSound(): SoundOption {
    const call = ding.configure.mock.calls.at(-1);
    if (!call) throw new Error("toast.configure was not called");
    return (call[0] as { sound: SoundOption }).sound;
}

beforeEach(() => {
    ding.chime.mockClear();
    ding.configure.mockClear();
    ding.error.mockClear();
});

describe("error toasts", () => {
    it("close on their own when they have no button", () => {
        toast.error("Upload failed", { description: "Too large" });
        expect(ding.error).toHaveBeenCalledWith("Upload failed", {
            description: "Too large",
            duration: 8000,
        });
    });

    it("stay until closed when they have a button", () => {
        const action = { label: "Report", onClick: () => {} };
        toast.error("Server error", { action });
        expect(ding.error).toHaveBeenCalledWith("Server error", { action });
    });

    it("keep an explicit duration", () => {
        toast.error("Heads up", { duration: 0 });
        expect(ding.error).toHaveBeenCalledWith("Heads up", { duration: 0 });
    });
});

describe("toast sound", () => {
    it("chimes for errors only when sound is on", () => {
        setToastSound(true);
        const sound = configuredSound();
        if (sound === false) throw new Error("sound should be a function");

        sound("success");
        sound("info");
        expect(ding.chime).not.toHaveBeenCalled();

        sound("error");
        expect(ding.chime).toHaveBeenCalledWith("error");
    });

    it("turns toast sound off entirely", () => {
        setToastSound(false);
        expect(configuredSound()).toBe(false);
    });

    it("plays the new-recordings cue only when sound is on", () => {
        setToastSound(true);
        chimeNewRecordings();
        expect(ding.chime).toHaveBeenCalledWith("success");

        ding.chime.mockClear();
        setToastSound(false);
        chimeNewRecordings();
        expect(ding.chime).not.toHaveBeenCalled();
    });
});
