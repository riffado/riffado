"use client";

import { AlertTriangle, X } from "lucide-react";
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
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                    {state === "ending-soon" ? (
                        <div className="space-y-0.5">
                            <p className="text-sm font-medium text-foreground">
                                Your Plaud connection ends on {endsOn}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Reconnect to keep syncing.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            <p className="text-sm font-medium text-foreground">
                                Your Plaud connection needs to be reconnected
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Plaud stopped accepting your saved sign-in, so
                                new recordings aren't syncing. Reconnect to
                                resume. Your existing recordings stay put.
                            </p>
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                    <Button onClick={() => setOpen(true)}>Reconnect</Button>
                    {state === "ending-soon" && (
                        <button
                            type="button"
                            onClick={dismissEndingSoon}
                            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="Dismiss Plaud connection ending notice"
                        >
                            <X className="size-4" />
                        </button>
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
