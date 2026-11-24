"use client";

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

const DISMISS_KEY = "riffado-trial-banner-dismissed";

interface BillingState {
    enabled: boolean;
    plan: "self_host" | "hosted_free" | "hosted_pro";
    planTransitionUntil: string | null;
    foundingOfferAvailable?: boolean;
    grace: { deletionAt: string; path: "trial" | "paid" } | null;
    subscription: { id: string } | null;
}

export type BannerMode =
    | {
          kind: "trial" | "transition";
          daysLeft: number | null;
          transitionUntil: string | null;
          foundingOfferAvailable: boolean;
      }
    | { kind: "grace"; deletionAt: string; path: "trial" | "paid" }
    | { kind: "locked" };

function daysUntil(iso: string): number {
    return Math.max(
        0,
        Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60_000)),
    );
}

/** Resolve the hosted billing notice from the server billing snapshot. */
export function resolveBillingBannerMode(
    body: BillingState,
): BannerMode | null {
    if (!body.enabled || body.plan === "self_host") return null;

    // Grace: account scheduled for deletion. Highest urgency.
    if (body.grace) {
        return {
            kind: "grace",
            deletionAt: body.grace.deletionAt,
            path: body.grace.path,
        };
    }

    if (body.plan === "hosted_free") {
        // The database keeps grandfathered users on hosted_free while their
        // transition window grants effective Pro entitlements. Treat that as
        // a free transition, not a lockout.
        if (
            body.planTransitionUntil &&
            new Date(body.planTransitionUntil).getTime() > Date.now()
        ) {
            return {
                kind: "transition",
                daysLeft: daysUntil(body.planTransitionUntil),
                transitionUntil: body.planTransitionUntil,
                foundingOfferAvailable: body.foundingOfferAvailable === true,
            };
        }
        return { kind: "locked" };
    }

    // Trial nudge: on Pro entitlements via the trial window but no card
    // on file yet.
    if (body.plan === "hosted_pro" && !body.subscription) {
        return {
            kind: "trial",
            daysLeft: body.planTransitionUntil
                ? daysUntil(body.planTransitionUntil)
                : null,
            transitionUntil: body.planTransitionUntil,
            foundingOfferAvailable: body.foundingOfferAvailable === true,
        };
    }

    return null;
}

function BannerCard({
    tone,
    title,
    body,
    actions,
    onDismiss,
    dismissLabel,
}: {
    tone: StatusTone;
    title: string;
    body: string;
    actions: ReactNode;
    onDismiss?: () => void;
    dismissLabel?: string;
}) {
    return (
        <div className="pb-2.5 lg:pb-0">
            <div className="squircle flex gap-3 rounded-[var(--radius-item)] border border-accent bg-card p-3.5 dark:border-border">
                <div className="flex w-2 shrink-0 pt-1.5">
                    <StatusDot tone={tone} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.75">
                        <p className="text-ui font-semibold text-strong">
                            {title}
                        </p>
                        <p className="text-small text-subtle">{body}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">{actions}</div>
                </div>
                {onDismiss ? (
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        onClick={onDismiss}
                        className="-mt-1 -mr-1 shrink-0 text-muted-foreground hover:text-foreground sm:mt-0 sm:self-center dark:hover:bg-border"
                        aria-label={dismissLabel}
                    >
                        <X className="size-4" />
                    </Button>
                ) : null}
            </div>
        </div>
    );
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
            .then((body: BillingState) =>
                setMode(resolveBillingBannerMode(body)),
            )
            .catch(() => {
                // Banner is a nice-to-have; ignore failures.
            });
    }, [isHosted]);

    const dismissKey =
        mode?.kind === "trial" || mode?.kind === "transition"
            ? `${DISMISS_KEY}:${mode.transitionUntil ?? "unknown"}`
            : DISMISS_KEY;

    useEffect(() => {
        if (typeof window === "undefined") return;
        setDismissed(localStorage.getItem(dismissKey) === "1");
    }, [dismissKey]);

    const dismiss = useCallback(() => {
        localStorage.setItem(dismissKey, "1");
        setDismissed(true);
    }, [dismissKey]);

    const goToBilling = useCallback(() => {
        window.location.href = "/settings#billing";
    }, []);

    const goToExport = useCallback(() => {
        window.location.href = "/settings#export";
    }, []);

    if (!mode) return null;

    if (mode.kind === "trial" || mode.kind === "transition") {
        // Last 3 days: force the banner to stay visible regardless of an
        // earlier dismissal, since a card-add nudge right before the
        // trial ends is the whole point. The dismiss control is hidden
        // for this window below so it isn't a button that visibly does
        // nothing when clicked.
        const forcedVisible = mode.daysLeft !== null && mode.daysLeft <= 3;
        if (dismissed && !forcedVisible) {
            return null;
        }
        const windowName =
            mode.kind === "trial" ? "trial" : "free Hosted Pro window";
        const title =
            mode.daysLeft !== null
                ? `${mode.daysLeft} day${mode.daysLeft !== 1 ? "s" : ""} left in your ${windowName}`
                : `Your ${windowName} is running`;
        const body = mode.foundingOfferAvailable
            ? "Add a card and choose the monthly plan to lock in founding-member pricing."
            : `Add a card and choose a plan to keep Hosted Pro after your ${windowName}.`;
        return (
            <BannerCard
                tone="working"
                title={title}
                body={body}
                actions={
                    <Button variant="ink" size="compact" onClick={goToBilling}>
                        {mode.kind === "trial" ? "Add card" : "See plans"}
                    </Button>
                }
                onDismiss={forcedVisible ? undefined : dismiss}
                dismissLabel={`Dismiss ${mode.kind === "trial" ? "trial" : "Hosted Pro transition"} banner`}
            />
        );
    }

    // grace + locked gate the account and are not dismissible.
    const isGrace = mode.kind === "grace";
    const title = isGrace
        ? mode.path === "trial"
            ? "Your trial ended"
            : "Your subscription ended"
        : "Your free Hosted Pro window has ended";
    const body = isGrace
        ? `Recordings still play and export. Sync and new transcriptions are paused, and the account is deleted on ${formatDate(mode.deletionAt)}.`
        : "Your account is read-only. Sync, upload and transcription are paused until you subscribe. You can still export your data.";
    return (
        <BannerCard
            tone="attention"
            title={title}
            body={body}
            actions={
                <>
                    <Button
                        variant="outline"
                        size="compact"
                        onClick={goToExport}
                    >
                        Export
                    </Button>
                    <Button variant="ink" size="compact" onClick={goToBilling}>
                        Subscribe
                    </Button>
                </>
            }
        />
    );
}
