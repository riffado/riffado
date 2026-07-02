"use client";

import { AlertTriangle, CreditCard, Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "riffado-trial-banner-dismissed";

interface BillingState {
    enabled: boolean;
    plan: "self_host" | "hosted_free" | "hosted_pro";
    planTransitionUntil: string | null;
    grace: { deletionAt: string; path: "trial" | "paid" } | null;
    subscription: { id: string } | null;
}

type BannerMode =
    | { kind: "trial"; daysLeft: number | null }
    | { kind: "grace"; deletionAt: string; path: "trial" | "paid" }
    | { kind: "locked" };

function daysUntil(iso: string): number {
    return Math.max(
        0,
        Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60_000)),
    );
}

function resolveMode(body: BillingState): BannerMode | null {
    if (!body.enabled || body.plan === "self_host") return null;

    // Grace: account scheduled for deletion. Highest urgency.
    if (body.grace) {
        return {
            kind: "grace",
            deletionAt: body.grace.deletionAt,
            path: body.grace.path,
        };
    }

    // Locked: lapsed hosted_free with no deletion scheduled (e.g. a
    // grandfathered account whose transition window expired). Read-only
    // until they subscribe.
    if (body.plan === "hosted_free") return { kind: "locked" };

    // Trial nudge: on Pro entitlements via the trial window but no card
    // on file yet.
    if (body.plan === "hosted_pro" && !body.subscription) {
        return {
            kind: "trial",
            daysLeft: body.planTransitionUntil
                ? daysUntil(body.planTransitionUntil)
                : null,
        };
    }

    return null;
}

/**
 * Hosted billing banner. Covers three states off a single
 * `/api/billing/me` read: the trial nudge (dismissible), the grace
 * countdown before deletion, and the lapsed-account lockout. Grace and
 * lockout are not dismissible -- they gate the account. Renders nothing
 * on self-host or for healthy subscribers.
 */
export function TrialBanner({ isHosted }: { isHosted: boolean }) {
    const [mode, setMode] = useState<BannerMode | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!isHosted) return;
        fetch("/api/billing/me")
            .then((r) => r.json())
            .then((body: BillingState) => setMode(resolveMode(body)))
            .catch(() => {
                // Banner is a nice-to-have; ignore failures.
            });
    }, [isHosted]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    }, []);

    const dismiss = useCallback(() => {
        localStorage.setItem(DISMISS_KEY, "1");
        setDismissed(true);
    }, []);

    const goToBilling = useCallback(() => {
        window.location.href = "/settings#billing";
    }, []);

    const goToExport = useCallback(() => {
        window.location.href = "/settings#export";
    }, []);

    if (!mode) return null;

    if (mode.kind === "trial") {
        if (dismissed) return null;
        return (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <CreditCard className="size-4 shrink-0 text-primary" />
                <p className="flex-1 text-sm text-foreground">
                    {mode.daysLeft !== null ? (
                        <>
                            <span className="font-medium">
                                {mode.daysLeft} day
                                {mode.daysLeft !== 1 && "s"} left in your trial.
                            </span>{" "}
                        </>
                    ) : null}
                    Add a card now to lock{" "}
                    <span className="font-medium">
                        founding-member pricing for life
                    </span>
                    .
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={goToBilling}
                    className="shrink-0"
                >
                    Add card
                </Button>
                <button
                    type="button"
                    onClick={dismiss}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Dismiss trial banner"
                >
                    <X className="size-4" />
                </button>
            </div>
        );
    }

    // grace + locked share the destructive treatment and are not
    // dismissible.
    const isGrace = mode.kind === "grace";
    return (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex-1 text-sm text-foreground">
                <p className="font-medium">
                    {isGrace
                        ? mode.path === "trial"
                            ? "Your trial ended."
                            : "Your subscription ended."
                        : "Your hosted plan has lapsed."}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                    {isGrace
                        ? `Your recordings are still playable and exportable, but sync and new transcriptions are paused. Scheduled for deletion in ${daysUntil(mode.deletionAt)} day(s).`
                        : "Your account is read-only — sync, upload, and transcription are paused. Subscribe to resume, or export your data."}
                </p>
            </div>
            <div className="flex shrink-0 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={goToExport}
                    className="shrink-0"
                >
                    <Download className="mr-1.5 size-4" />
                    Export
                </Button>
                <Button size="sm" onClick={goToBilling} className="shrink-0">
                    Subscribe
                </Button>
            </div>
        </div>
    );
}
