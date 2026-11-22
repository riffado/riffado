import { chime, type ToastOptions } from "@yusufceng1z/ding";
import { toast as dingToast } from "@yusufceng1z/ding-react";

/** How long an error without a button stays before closing on its own. */
const ERROR_DURATION_MS = 8000;

/**
 * App-wide toasts. Every toast call imports from here, so swapping the
 * library only touches this file and `components/ui/toaster.tsx`.
 *
 * Toasts close on their own unless they need the user: a toast with a
 * button (such as "Report") stays until closed with the x, Esc or a swipe.
 * Errors without a button close after a longer delay than other toasts.
 */
export const toast: typeof dingToast = {
    ...dingToast,
    error: (title: string, opts?: ToastOptions) =>
        dingToast.error(
            title,
            opts?.action || opts?.duration !== undefined
                ? opts
                : { ...opts, duration: ERROR_DURATION_MS },
        ),
};

let soundEnabled = false;

/**
 * Applies the user's "Notification sound" setting. When on, error toasts
 * play a short cue; other toasts stay silent. Call with the stored setting
 * on load and again whenever the user changes it.
 */
export function setToastSound(enabled: boolean): void {
    soundEnabled = enabled;
    dingToast.configure({
        sound: enabled
            ? (type) => {
                  if (type === "error") chime(type);
              }
            : false,
    });
}

/** Plays the arrival cue for newly synced recordings, if sound is on. */
export function chimeNewRecordings(): void {
    if (soundEnabled) chime("success");
}
