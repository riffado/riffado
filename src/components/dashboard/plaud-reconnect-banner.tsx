"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { formatDateTime } from "@/lib/format-date";
import {
    PLAUD_SESSION_WARNING_WINDOW_MS,
    plaudConnectionBannerState,
} from "@/lib/plaud/connection-expiry";

const ENDING_SOON_DISMISS_KEY = "riffado-plaud-ending-soon-dismissed";
const MAX_CLOCK_TICK_MS = 60 * 60 * 1000;

function msUntilNextBannerChange(
    sessionExpiresAt: string | null,
    now: number,
): number | null {
    if (!sessionExpiresAt) return null;
    const endsAt = new Date(sessionExpiresAt).getTime();
    if (Number.isNaN(endsAt)) return null;
    const next = [endsAt - PLAUD_SESSION_WARNING_WINDOW_MS, endsAt].find(
        (deadline) => deadline > now,
    );
    if (next === undefined) return null;
    return Math.min(next - now, MAX_CLOCK_TICK_MS);
}

interface PlaudReconnectBannerProps {
    /**
     * True when the stored Plaud token was rejected and the user must
     * reconnect. Driven by the server-rendered connection state on first
     * paint and by the live sync result thereafter.
     */
    show: boolean;
    /**
     * When the Plaud sign-in ends for good (ISO string), or null when
     * unknown. The banner also appears within three days of this.
     */
    sessionExpiresAt: string | null;
    /**
     * Called after a successful reconnect so the parent can refresh server
     * data and kick off a fresh sync.
     */
    onReconnected: () => void;
}

/**
 * Dashboard banner shown when Plaud stops accepting the stored sign-in
 * (an expired user token with no working refresh token, a mistakenly-pasted
 * 24h workspace token that has died, or a revoked token), and in the three
 * days before the sign-in ends. The ending-soon notice can be dismissed;
 * the dismissal is stored per session end, so a new sign-in warns again.
 * After a reconnect the ending-soon notice for the old sign-in's end stays
 * hidden until the new end arrives; `show` is always honoured, so a
 * rejected replacement sign-in still shows the reconnect banner.
 * Re-reads the clock when the tab becomes visible and when the warning
 * window opens or the sign-in ends. Opens the connector-first connect flow
 * as a modal, not full re-onboarding.
 */
export function PlaudReconnectBanner({
    show,
    sessionExpiresAt,
    onReconnected,
}: PlaudReconnectBannerProps) {
    const [open, setOpen] = useState(false);
    const [reconnectedFrom, setReconnectedFrom] = useState<{
        sessionExpiresAt: string | null;
    } | null>(null);

    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const update = () => setNow(Date.now());
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") update();
        };
        update();
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () =>
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
    }, []);
    useEffect(() => {
        if (now === null) return;
        const delay = msUntilNextBannerChange(sessionExpiresAt, now);
        if (delay === null) return;
        const timer = window.setTimeout(() => setNow(Date.now()), delay);
        return () => window.clearTimeout(timer);
    }, [sessionExpiresAt, now]);

    const dismissKey = sessionExpiresAt
        ? `${ENDING_SOON_DISMISS_KEY}:${sessionExpiresAt}`
        : null;
    const [endingSoonDismissed, setEndingSoonDismissed] = useState(false);
    useEffect(() => {
        setEndingSoonDismissed(
            dismissKey !== null && localStorage.getItem(dismissKey) === "1",
        );
    }, [dismissKey]);
    const dismissEndingSoon = useCallback(() => {
        if (dismissKey) localStorage.setItem(dismissKey, "1");
        setEndingSoonDismissed(true);
    }, [dismissKey]);

    const showingOldSignIn =
        reconnectedFrom !== null &&
        reconnectedFrom.sessionExpiresAt === sessionExpiresAt;
    const state = plaudConnectionBannerState({
        needsReconnect: show,
        sessionExpiresAt:
            now === null || showingOldSignIn ? null : sessionExpiresAt,
        now: now ?? 0,
    });

    if (!state) return null;
    if (state === "ending-soon" && endingSoonDismissed) return null;

    const endsOn = sessionExpiresAt
        ? formatDateTime(sessionExpiresAt, "absolute")
        : null;

    return (
        <>
            <div className="pb-2.5 lg:px-2.5">
                <div className="squircle flex gap-3 rounded-[var(--radius-item)] border border-accent bg-card p-3.5">
                    <div className="flex w-2 shrink-0 pt-1.5">
                        <StatusDot tone="working" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        {state === "ending-soon" ? (
                            <div className="flex flex-col gap-0.75">
                                <p className="text-ui font-semibold text-strong">
                                    Your Plaud connection ends on {endsOn}
                                </p>
                                <p className="text-small text-subtle">
                                    Reconnect to keep syncing.
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-0.75">
                                <p className="text-ui font-semibold text-strong">
                                    Plaud signed you out
                                </p>
                                <p className="text-small text-subtle">
                                    Recordings you already have are safe. New
                                    ones wait in your Plaud account until you
                                    reconnect.
                                </p>
                            </div>
                        )}
                        <Button
                            variant="ink"
                            size="compact"
                            onClick={() => setOpen(true)}
                            className="w-fit"
                        >
                            Reconnect
                        </Button>
                    </div>
                    {state === "ending-soon" && (
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            onClick={dismissEndingSoon}
                            className="-mt-1 -mr-1 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label="Dismiss Plaud connection ending notice"
                        >
                            <X className="size-4" />
                        </Button>
                    )}
                </div>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Reconnect your Plaud account</DialogTitle>
                        <DialogDescription>
                            Sign back in to keep syncing. Your existing
                            recordings and transcripts are unaffected.
                        </DialogDescription>
                    </DialogHeader>
                    {open && (
                        <PlaudConnectTabs
                            onConnected={() => {
                                setOpen(false);
                                setReconnectedFrom({ sessionExpiresAt });
                                onReconnected();
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
