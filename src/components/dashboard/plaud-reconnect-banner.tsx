"use client";

import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { plaudConnectionBannerState } from "@/lib/plaud/connection-expiry";

const ENDING_SOON_DISMISS_KEY = "riffado-plaud-ending-soon-dismissed";

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
 * Opens the connector-first connect flow as a modal, not full
 * re-onboarding.
 */
export function PlaudReconnectBanner({
    show,
    sessionExpiresAt,
    onReconnected,
}: PlaudReconnectBannerProps) {
    const [open, setOpen] = useState(false);
    // Optimistically hide the banner the moment a reconnect succeeds, so it
    // doesn't linger until the next sync clears the server-side flag. Reset
    // when a *fresh* failure flips `show` false -> true again.
    const [dismissed, setDismissed] = useState(false);
    const prevShow = useRef(show);
    useEffect(() => {
        if (show && !prevShow.current) setDismissed(false);
        prevShow.current = show;
    }, [show]);

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

    const state = plaudConnectionBannerState({
        needsReconnect: show,
        sessionExpiresAt: now === null ? null : sessionExpiresAt,
        now: now ?? 0,
    });

    if (!state || dismissed) return null;
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
                                setDismissed(true);
                                onReconnected();
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
