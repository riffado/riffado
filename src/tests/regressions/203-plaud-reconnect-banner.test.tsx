/**
 * @vitest-environment jsdom
 *
 * Plaud reconnect banner (follow-up to issue #203): the "connection ends
 * soon" notice can be dismissed, the dismissal is stored per session end so
 * a new sign-in warns again, and the banner re-reads the clock when the tab
 * becomes visible instead of keeping the time from first mount.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaudReconnectBanner } from "@/components/dashboard/plaud-reconnect-banner";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-18T12:00:00Z").getTime();

function renderBanner(sessionExpiresAt: string | null) {
    return render(
        <PlaudReconnectBanner
            show={false}
            sessionExpiresAt={sessionExpiresAt}
            onReconnected={() => {}}
        />,
    );
}

function endingNotice() {
    return screen.queryByText(/Your Plaud connection ends on/);
}

let nowMs = NOW;

beforeEach(() => {
    nowMs = NOW;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("PlaudReconnectBanner ending-soon dismissal", () => {
    it("remembers a dismissal for the same session end across mounts", () => {
        const sessionEnd = new Date(NOW + 2 * DAY_MS).toISOString();
        renderBanner(sessionEnd);
        expect(endingNotice()).not.toBeNull();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Dismiss Plaud connection ending notice",
            }),
        );
        expect(endingNotice()).toBeNull();
        expect(
            localStorage.getItem(
                `riffado-plaud-ending-soon-dismissed:${sessionEnd}`,
            ),
        ).toBe("1");

        cleanup();
        renderBanner(sessionEnd);
        expect(endingNotice()).toBeNull();
    });

    it("warns again for a new session end", () => {
        const firstEnd = new Date(NOW + 2 * DAY_MS).toISOString();
        renderBanner(firstEnd);
        fireEvent.click(
            screen.getByRole("button", {
                name: "Dismiss Plaud connection ending notice",
            }),
        );
        cleanup();

        renderBanner(new Date(NOW + 2.5 * DAY_MS).toISOString());
        expect(endingNotice()).not.toBeNull();
    });

    it("cannot dismiss the reconnect state", () => {
        render(
            <PlaudReconnectBanner
                show
                sessionExpiresAt={new Date(NOW + 2 * DAY_MS).toISOString()}
                onReconnected={() => {}}
            />,
        );
        expect(
            screen.getByText("Your Plaud connection needs to be reconnected"),
        ).not.toBeNull();
        expect(
            screen.queryByRole("button", {
                name: "Dismiss Plaud connection ending notice",
            }),
        ).toBeNull();
    });
});

describe("PlaudReconnectBanner clock", () => {
    it("re-reads the time when the tab becomes visible", () => {
        renderBanner(new Date(NOW + 3 * DAY_MS + 60_000).toISOString());
        expect(endingNotice()).toBeNull();

        nowMs = NOW + 2 * 60_000;
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(endingNotice()).not.toBeNull();
    });
});
