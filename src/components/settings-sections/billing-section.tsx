"use client";

import {
    AlertTriangle,
    CreditCard,
    Download,
    ExternalLink,
    Loader2,
    Receipt,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

interface BillingState {
    enabled: boolean;
    plan: "self_host" | "hosted_free" | "hosted_pro";
    planTransitionUntil: string | null;
    foundingMember: boolean;
    everPaidAt: string | null;
    grace: {
        deletionAt: string;
        path: "trial" | "paid";
    } | null;
    entitlements: {
        maxStorageBytes: number | null;
        maxDevices: number | null;
        monthlyMynahSeconds: number;
    };
    usage: {
        storageBytes: number;
        monthlyMynahSecondsRemaining: number;
        monthlyMynahGrantResetAt: string | null;
    };
    pricing: {
        usd: string | null;
        eur: string | null;
    };
    subscription: {
        id: string;
        status: string;
        nextPaymentAt: string | null;
        canceledAt: string | null;
        amountValue: string;
        amountCurrency: string;
    } | null;
}

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function daysBetween(future: Date, now: Date): number {
    const ms = future.getTime() - now.getTime();
    if (ms <= 0) return 0;
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatSeconds(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

function formatMoney(value: string, currency: string): string {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return `${value} ${currency}`;
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
        }).format(amount);
    } catch {
        return `${value} ${currency}`;
    }
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function formatProPrice(pricing: BillingState["pricing"]): string {
    const parts = [
        pricing.usd ? `$${Number.parseFloat(pricing.usd).toString()}/mo` : null,
        pricing.eur ? `€${Number.parseFloat(pricing.eur).toString()}/mo` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" or ") : "Pro monthly";
}

/** formatBytes but without a noisy trailing ".00" on round caps. */
function prettyBytes(bytes: number): string {
    return formatBytes(bytes).replace(".00 ", " ");
}

type StatusTone = "active" | "warn" | "neutral";

const TONE_DOT: Record<StatusTone, string> = {
    active: "bg-[var(--led-active)]",
    warn: "bg-[var(--led-warning)]",
    neutral: "bg-muted-foreground/60",
};

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground">
            <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
            {label}
        </span>
    );
}

/** Usage meter with a used-fraction bar that turns amber near the cap. */
function UsageMeter({
    label,
    detail,
    usedPct,
    footer,
}: {
    label: string;
    detail: string;
    usedPct: number | null;
    footer?: string;
}) {
    const pct = usedPct === null ? null : Math.max(0, Math.min(100, usedPct));
    return (
        <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground tabular-nums">
                    {detail}
                </span>
            </div>
            {pct !== null && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                    <div
                        className={cn(
                            "h-full rounded-full transition-all",
                            pct >= 90
                                ? "bg-[var(--led-warning)]"
                                : "bg-primary",
                        )}
                        style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                    />
                </div>
            )}
            {footer && (
                <p className="mt-1.5 text-xs text-muted-foreground">{footer}</p>
            )}
        </div>
    );
}

export function BillingSection() {
    const confirm = useConfirm();
    const [state, setState] = useState<BillingState | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [waiver, setWaiver] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [portalLoading, setPortalLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/billing/me");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as BillingState;
            setState(data);
            setLoadError(null);
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to load billing state";
            setLoadError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const startCheckout = useCallback(async (): Promise<void> => {
        const res = await fetch("/api/billing/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                withdrawalWaiver: true,
                redirectUrl: `${window.location.origin}/settings#billing`,
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
            checkoutUrl?: string;
            reactivated?: boolean;
        };
        if (body.checkoutUrl) {
            window.location.href = body.checkoutUrl;
            return;
        }
        if (body.reactivated) {
            toast.success("Your subscription will continue");
            await load();
            return;
        }
        throw new Error("Unexpected checkout response");
    }, [load]);

    const handleSubscribe = useCallback(async () => {
        if (!waiver) {
            toast.error("Please confirm the consumer-law waiver to continue.");
            return;
        }
        setSubmitting(true);
        try {
            await startCheckout();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Checkout failed");
        } finally {
            setSubmitting(false);
        }
    }, [waiver, startCheckout]);

    const handleResume = useCallback(async () => {
        setSubmitting(true);
        try {
            await startCheckout();
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to resume subscription",
            );
        } finally {
            setSubmitting(false);
        }
    }, [startCheckout]);

    const handlePortal = useCallback(async () => {
        setPortalLoading(true);
        try {
            const res = await fetch("/api/billing/portal", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    returnUrl: `${window.location.origin}/settings#billing`,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const body = (await res.json()) as { url: string };
            window.location.href = body.url;
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to open the billing portal",
            );
            setPortalLoading(false);
        }
    }, []);

    const handleDeleteNow = useCallback(() => {
        void confirm({
            title: "Delete your account now?",
            description:
                "All your recordings, transcripts, and summaries will be permanently removed. This cannot be undone. If you want a copy, export your data first.",
            confirmLabel: "Delete everything",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
                const res = await fetch("/api/billing/delete-now", {
                    method: "POST",
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error ?? `HTTP ${res.status}`);
                }
                toast.success(
                    "Deletion queued. Your account will be removed within 5 minutes.",
                );
                await load();
            },
        });
    }, [confirm, load]);

    const handleCancel = useCallback(
        (periodEnd: string | null) => {
            void confirm({
                title: "Cancel your subscription?",
                description: (
                    <>
                        You keep full access
                        {periodEnd
                            ? ` until ${formatDate(periodEnd)}`
                            : " until the end of your current paid period"}
                        . After that your account becomes read-only. Your
                        recordings and transcripts stay put, but sync, upload,
                        and transcription pause until you resubscribe.
                    </>
                ),
                confirmLabel: "Cancel subscription",
                cancelLabel: "Keep subscription",
                pendingLabel: "Canceling…",
                destructive: true,
                onConfirm: async () => {
                    const res = await fetch("/api/billing/cancel", {
                        method: "POST",
                    });
                    if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.error ?? `HTTP ${res.status}`);
                    }
                    toast.success("Subscription canceled");
                    await load();
                },
            });
        },
        [confirm, load],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!state) {
        return (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                    {loadError ?? "Failed to load billing state."}
                </p>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                    Try again
                </Button>
            </div>
        );
    }

    if (!state.enabled) {
        return (
            <>
                <SettingsSectionHeader
                    icon={CreditCard}
                    title="Billing"
                    description="Hosted billing is not configured on this instance."
                />
                <SettingsCard>
                    <p className="text-sm text-muted-foreground">
                        Self-host instances run on the AGPL source with no paid
                        plan. To enable hosted billing, the operator must set{" "}
                        <code>BILLING_ENABLED=true</code> and
                        <code> STRIPE_SECRET_KEY</code>.
                    </p>
                </SettingsCard>
            </>
        );
    }

    const sub = state.subscription;
    const hasLiveSub = sub !== null && LIVE_STATUSES.has(sub.status);
    const cancelPending = hasLiveSub && sub.canceledAt !== null;
    const isTrial = state.plan === "hosted_pro" && !hasLiveSub;
    const isLapsed = state.plan === "hosted_free";

    let planName: string;
    let planNote: string | null = null;
    switch (state.plan) {
        case "self_host":
            planName = "Self-hosted";
            break;
        case "hosted_pro":
            if (isTrial) {
                planName = "Free trial";
                planNote = state.planTransitionUntil
                    ? `Your trial ends on ${formatDate(state.planTransitionUntil)}. Add a card below to keep your recordings syncing.`
                    : "Add a card below to keep your recordings syncing after the trial.";
            } else {
                planName = "Pro";
            }
            break;
        case "hosted_free": {
            planName = "Free";
            const inTransition =
                state.planTransitionUntil !== null &&
                new Date(state.planTransitionUntil) > new Date();
            planNote =
                inTransition && state.planTransitionUntil
                    ? `You keep full access until ${formatDate(state.planTransitionUntil)}. Subscribe before then to avoid interruption.`
                    : "Your recordings and transcripts are safe, but syncing, uploads, and new transcriptions are paused until you subscribe.";
            break;
        }
    }

    let status: { label: string; tone: StatusTone };
    if (state.plan === "self_host") {
        status = { label: "Self-hosted", tone: "neutral" };
    } else if (isTrial) {
        status = { label: "Trial", tone: "warn" };
    } else if (isLapsed) {
        status = { label: "Read-only", tone: "neutral" };
    } else if (sub?.status === "past_due") {
        status = { label: "Past due", tone: "warn" };
    } else if (cancelPending) {
        status = { label: "Canceling", tone: "warn" };
    } else {
        status = { label: "Active", tone: "active" };
    }

    const storagePct =
        state.entitlements.maxStorageBytes !== null
            ? (state.usage.storageBytes / state.entitlements.maxStorageBytes) *
              100
            : null;
    const mynahTotal = state.entitlements.monthlyMynahSeconds;
    const mynahUsed = Math.max(
        0,
        mynahTotal - state.usage.monthlyMynahSecondsRemaining,
    );
    const mynahPct = mynahTotal > 0 ? (mynahUsed / mynahTotal) * 100 : null;

    const proPrice = formatProPrice(state.pricing);
    const proPriceNote = isTrial
        ? "Add a card before your trial ends. Stripe confirms the exact charge before you subscribe."
        : "Stripe confirms the exact charge before you subscribe.";

    const graceBanner =
        state.grace !== null ? (
            <SettingsCard>
                <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                    <div className="flex-1 space-y-2">
                        <div>
                            <h3 className="text-sm font-semibold text-foreground">
                                {state.grace.path === "trial"
                                    ? "Your trial has ended"
                                    : "Your subscription has ended"}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Your account will be permanently deleted on{" "}
                                {formatDate(state.grace.deletionAt)} (in{" "}
                                {daysBetween(
                                    new Date(state.grace.deletionAt),
                                    new Date(),
                                )}{" "}
                                day(s)). Until then you can still play and
                                export your recordings; syncing and new
                                transcriptions are paused. Subscribe below to
                                keep everything.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    window.location.hash = "export";
                                }}
                            >
                                <Download className="mr-2 size-4" />
                                Export my data
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleDeleteNow}
                                disabled={submitting}
                            >
                                Delete now
                            </Button>
                        </div>
                    </div>
                </div>
            </SettingsCard>
        ) : null;

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                icon={CreditCard}
                title="Billing"
                description="Manage your plan, usage, and subscription."
            />

            <div className="space-y-3">
                {graceBanner}

                <SettingsCard title="Plan">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-lg font-semibold leading-none">
                                    {planName}
                                </span>
                                {state.foundingMember && (
                                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                        Founding member
                                    </span>
                                )}
                            </div>
                            {hasLiveSub && sub && (
                                <p className="text-sm text-muted-foreground tabular-nums">
                                    {formatMoney(
                                        sub.amountValue,
                                        sub.amountCurrency,
                                    )}
                                    {cancelPending && sub.canceledAt
                                        ? ` · ends ${formatDate(sub.canceledAt)}`
                                        : sub.nextPaymentAt
                                          ? ` · renews ${formatDate(sub.nextPaymentAt)}`
                                          : ""}
                                </p>
                            )}
                            {planNote && (
                                <p className="text-sm text-muted-foreground">
                                    {planNote}
                                </p>
                            )}
                            {hasLiveSub && sub?.status === "past_due" && (
                                <p className="text-sm text-foreground">
                                    Your last payment didn't go through. Update
                                    your payment method to keep your
                                    subscription.
                                </p>
                            )}
                        </div>
                        <StatusPill label={status.label} tone={status.tone} />
                    </div>
                </SettingsCard>

                <SettingsCard title="Usage">
                    <div className="space-y-4">
                        <UsageMeter
                            label="Storage"
                            detail={`${prettyBytes(state.usage.storageBytes)} of ${
                                state.entitlements.maxStorageBytes !== null
                                    ? prettyBytes(
                                          state.entitlements.maxStorageBytes,
                                      )
                                    : "unlimited"
                            }`}
                            usedPct={storagePct}
                        />
                        <UsageMeter
                            label="Included transcription"
                            detail={`${formatSeconds(mynahUsed)} of ${formatSeconds(mynahTotal)}`}
                            usedPct={mynahPct}
                            footer={[
                                `${formatSeconds(state.usage.monthlyMynahSecondsRemaining)} left this month`,
                                state.usage.monthlyMynahGrantResetAt
                                    ? `resets ${formatDate(state.usage.monthlyMynahGrantResetAt)}`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        />
                    </div>
                </SettingsCard>

                {!hasLiveSub ? (
                    <SettingsCard
                        title={
                            isTrial
                                ? "Keep Pro after your trial"
                                : isLapsed && state.everPaidAt
                                  ? "Resubscribe to Pro"
                                  : "Upgrade to Pro"
                        }
                    >
                        <div className="space-y-4">
                            <div>
                                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                                    {proPrice}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {proPriceNote}
                                </p>
                            </div>
                            <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                                <li>50 GB storage</li>
                                <li>
                                    15 hours of Mynah transcription per month
                                </li>
                                <li>Unlimited devices, background sync</li>
                            </ul>
                            <div className="flex items-start gap-2">
                                <input
                                    id="waiver"
                                    type="checkbox"
                                    checked={waiver}
                                    onChange={(e) =>
                                        setWaiver(e.target.checked)
                                    }
                                    className="mt-0.5 size-4 rounded border-input"
                                />
                                <Label
                                    htmlFor="waiver"
                                    className="text-xs leading-snug text-muted-foreground"
                                >
                                    Start Pro immediately after checkout. I
                                    understand the service begins right away and
                                    that the usual 14-day EU withdrawal right no
                                    longer applies once the paid plan starts.
                                </Label>
                            </div>
                            <Button
                                onClick={handleSubscribe}
                                disabled={!waiver || submitting}
                            >
                                {submitting ? (
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                ) : (
                                    <ExternalLink className="mr-2 size-4" />
                                )}
                                Subscribe via Stripe
                            </Button>
                        </div>
                    </SettingsCard>
                ) : (
                    <SettingsCard title="Manage subscription">
                        <div className="space-y-3">
                            {cancelPending && sub?.canceledAt ? (
                                <>
                                    <p className="text-sm text-muted-foreground">
                                        Your subscription is set to end on{" "}
                                        {formatDate(sub.canceledAt)}. You keep
                                        full access until then. Resume any time
                                        before that date at no extra charge.
                                        Your next payment simply continues as
                                        scheduled.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            onClick={handleResume}
                                            disabled={submitting}
                                        >
                                            {submitting && (
                                                <Loader2 className="mr-2 size-4 animate-spin" />
                                            )}
                                            Resume subscription
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handlePortal}
                                            disabled={portalLoading}
                                        >
                                            {portalLoading ? (
                                                <Loader2 className="mr-2 size-4 animate-spin" />
                                            ) : (
                                                <Receipt className="mr-2 size-4" />
                                            )}
                                            Payment method & invoices
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-muted-foreground">
                                        Update your card or download invoices
                                        anytime in the billing portal.
                                    </p>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={handlePortal}
                                            disabled={portalLoading}
                                        >
                                            {portalLoading ? (
                                                <Loader2 className="mr-2 size-4 animate-spin" />
                                            ) : (
                                                <Receipt className="mr-2 size-4" />
                                            )}
                                            Payment method & invoices
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-muted-foreground hover:text-destructive"
                                            onClick={() =>
                                                handleCancel(
                                                    sub?.nextPaymentAt ?? null,
                                                )
                                            }
                                        >
                                            Cancel subscription
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </SettingsCard>
                )}
            </div>
        </div>
    );
}
