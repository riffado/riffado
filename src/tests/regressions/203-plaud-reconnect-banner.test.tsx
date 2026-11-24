/**
 * @vitest-environment jsdom
 *
 * Plaud reconnect banner (follow-up to issue #203): the "connection ends
 * soon" notice can be dismissed, the dismissal is stored per session end so
 * a new sign-in warns again, the banner re-reads the clock when the tab
 * becomes visible and when a warning deadline passes, and hiding the banner
 * after a reconnect does not hide the new sign-in's own warnings.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/plaud-connect/connect-dialog", () => ({
    PlaudConnectDialog: ({
        open,
        onConnected,
    }: {
        open: boolean;
        onConnected: () => void;
    }) =>
        open ? (
            <button type="button" onClick={onConnected}>
                Finish reconnect
            </button>
        ) : null,
}));

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

function reconnectNotice() {
    return screen.queryByText("Plaud signed you out");
}

function bannerProps(show: boolean, sessionExpiresAt: string | null) {
    return { show, sessionExpiresAt, onReconnected: () => {} };
}

function reconnectThroughDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish reconnect" }));
}

let nowMs = NOW;

beforeEach(() => {
    nowMs = NOW;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
        expect(screen.getByText("Plaud signed you out")).not.toBeNull();
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

    it("shows the warning when the three-day point passes while the tab stays visible", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        renderBanner(new Date(NOW + 3 * DAY_MS + 60_000).toISOString());
        expect(endingNotice()).toBeNull();

        nowMs = NOW + 60_000;
        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect(endingNotice()).not.toBeNull();
    });

    it("switches to the reconnect banner when the sign-in ends", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        renderBanner(new Date(NOW + 30_000).toISOString());
        expect(endingNotice()).not.toBeNull();

        nowMs = NOW + 30_000;
        act(() => {
            vi.advanceTimersByTime(30_000);
        });

        expect(endingNotice()).toBeNull();
        expect(reconnectNotice()).not.toBeNull();
    });

    it("re-checks at least hourly when the next deadline is weeks away", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        renderBanner(new Date(NOW + 30 * DAY_MS).toISOString());

        nowMs = NOW + 27 * DAY_MS + 60_000;
        act(() => {
            vi.advanceTimersByTime(60 * 60 * 1000);
        });

        expect(endingNotice()).not.toBeNull();
    });

    it("clears its timer on unmount", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { unmount } = renderBanner(
            new Date(NOW + 10 * DAY_MS).toISOString(),
        );
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("PlaudReconnectBanner after a reconnect", () => {
    it("shows the reconnect banner again when the replacement sign-in is rejected", () => {
        const oldEnd = new Date(NOW + 20 * DAY_MS).toISOString();
        const { rerender } = render(
            <PlaudReconnectBanner {...bannerProps(true, oldEnd)} />,
        );
        reconnectThroughDialog();
        rerender(<PlaudReconnectBanner {...bannerProps(false, oldEnd)} />);
        expect(reconnectNotice()).toBeNull();

        const newEnd = new Date(NOW + 30 * DAY_MS).toISOString();
        rerender(<PlaudReconnectBanner {...bannerProps(true, newEnd)} />);
        expect(reconnectNotice()).not.toBeNull();
    });

    it("honours show even when it never went false after the reconnect", () => {
        const oldEnd = new Date(NOW + 20 * DAY_MS).toISOString();
        const { rerender } = render(
            <PlaudReconnectBanner {...bannerProps(true, oldEnd)} />,
        );
        reconnectThroughDialog();

        const newEnd = new Date(NOW + 30 * DAY_MS).toISOString();
        rerender(<PlaudReconnectBanner {...bannerProps(true, newEnd)} />);
        expect(reconnectNotice()).not.toBeNull();
    });

    it("keeps the old sign-in's ending-soon notice hidden until the new end arrives", () => {
        const oldEnd = new Date(NOW + 2 * DAY_MS).toISOString();
        const { rerender } = render(
            <PlaudReconnectBanner {...bannerProps(false, oldEnd)} />,
        );
        expect(endingNotice()).not.toBeNull();
        reconnectThroughDialog();
        expect(endingNotice()).toBeNull();

        rerender(<PlaudReconnectBanner {...bannerProps(false, oldEnd)} />);
        expect(endingNotice()).toBeNull();

        const newEnd = new Date(NOW + DAY_MS).toISOString();
        rerender(<PlaudReconnectBanner {...bannerProps(false, newEnd)} />);
        expect(endingNotice()).not.toBeNull();
    });

    it("shows the replacement sign-in's ending-soon warning", () => {
        const oldEnd = new Date(NOW + 20 * DAY_MS).toISOString();
        const { rerender } = render(
            <PlaudReconnectBanner {...bannerProps(true, oldEnd)} />,
        );
        reconnectThroughDialog();

        const newEnd = new Date(NOW + DAY_MS).toISOString();
        rerender(<PlaudReconnectBanner {...bannerProps(false, newEnd)} />);
        expect(endingNotice()).not.toBeNull();
    });

    it("hides the ended sign-in at once, then warns about the replacement", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { rerender } = render(
            <PlaudReconnectBanner
                {...bannerProps(false, new Date(NOW - 1000).toISOString())}
            />,
        );
        expect(reconnectNotice()).not.toBeNull();
        reconnectThroughDialog();
        expect(reconnectNotice()).toBeNull();

        const newEnd = new Date(NOW + 60_000).toISOString();
        rerender(<PlaudReconnectBanner {...bannerProps(false, newEnd)} />);
        expect(endingNotice()).not.toBeNull();

        nowMs = NOW + 60_000;
        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect(reconnectNotice()).not.toBeNull();
    });
});
