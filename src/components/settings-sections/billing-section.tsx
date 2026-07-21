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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

interface CatalogPrice {
    currency: "usd" | "eur";
    interval: "month" | "year";
    displayAmount: string | null;
    available: boolean;
}

type PriceCatalogSide = Record<"usd" | "eur", CatalogPrice | null>;

type BillingInterval = "month" | "year";

interface BillingState {
    enabled: boolean;
    /** Resolved the same way checkout resolves currency, so the pre-purchase
     * estimate below always matches what Stripe will actually charge. */
    resolvedCurrency?: "usd" | "eur";
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
        monthly: {
            founding: PriceCatalogSide;
            standard: PriceCatalogSide;
            foundingAvailability?: {
                capacity: number;
                claimed: number;
                reserved: number;
                remaining: number;
            };
        };
        annual: PriceCatalogSide;
    };
    subscription: {
        id: string;
        status: string;
        nextPaymentAt: string | null;
        canceledAt: string | null;
        amountValue: string;
        amountCurrency: string;
        interval: string;
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

function trimAmount(amount: string): string {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) ? parsed.toString() : amount;
}

/**
 * Pick the single price to display out of a catalog side that may carry
 * an entry per currency, falling back to whichever currency IS configured
 * if the preferred one isn't. Stripe only ever charges one currency --
 * never join both together in copy.
 */
function pickPrice(
    catalog: PriceCatalogSide,
    preferred: "usd" | "eur",
): CatalogPrice | null {
    return (
        catalog[preferred] ??
        catalog[preferred === "usd" ? "eur" : "usd"] ??
        null
    );
}

function formatProPrice(
    catalog: PriceCatalogSide,
    interval: BillingInterval,
    preferredCurrency: "usd" | "eur",
): string {
    const suffix = interval === "year" ? "/year" : "/month";
    const price = pickPrice(catalog, preferredCurrency);
    if (!price?.displayAmount) {
        return interval === "year" ? "Pro annual" : "Pro monthly";
    }
    const symbol = price.currency === "usd" ? "$" : "€";
    return `${symbol}${trimAmount(price.displayAmount)}${suffix}`;
}

/** Mirrored Stripe interval ("1 month", "1 year") to a display suffix. */
function subscriptionIntervalSuffix(interval: string): string {
    if (interval === "1 month") return "/month";
    if (interval === "1 year") return "/year";
    return interval ? ` every ${interval}` : "";
}

function billingIntervalFromMirroredInterval(
    interval: string,
): BillingInterval {
    return interval === "1 year" ? "year" : "month";
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
    const [buyingAsBusiness, setBuyingAsBusiness] = useState(false);
    const [businessName, setBusinessName] = useState("");
    const [businessVatId, setBusinessVatId] = useState("");
    const [interval, setInterval] = useState<BillingInterval>("month");
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

    const startCheckout = useCallback(
        async (checkoutInterval: BillingInterval): Promise<void> => {
            const res = await fetch("/api/billing/checkout", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    withdrawalWaiver: true,
                    interval: checkoutInterval,
                    ...(buyingAsBusiness
                        ? {
                              business: {
                                  name: businessName.trim(),
                                  vatId: businessVatId.trim(),
                              },
                          }
                        : {}),
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
        },
        [buyingAsBusiness, businessName, businessVatId, load],
    );

    const handleSubscribe = useCallback(
        async (checkoutInterval: BillingInterval) => {
            if (!waiver) {
                toast.error(
                    "Please confirm the consumer-law waiver to continue.",
                );
                return;
            }
            if (
                buyingAsBusiness &&
                (!businessName.trim() || !businessVatId.trim())
            ) {
                toast.error("Enter your business name and EU VAT ID.");
                return;
            }
            setSubmitting(true);
            try {
                await startCheckout(checkoutInterval);
            } catch (err) {
                toast.error(
                    err instanceof Error ? err.message : "Checkout failed",
                );
            } finally {
                setSubmitting(false);
            }
        },
        [waiver, buyingAsBusiness, businessName, businessVatId, startCheckout],
    );

    const handleResume = useCallback(async () => {
        setSubmitting(true);
        try {
            // Resuming clears a pending cancel on the existing subscription;
            // the interval is whatever that subscription already has.
            await startCheckout(
                billingIntervalFromMirroredInterval(
                    state?.subscription?.interval ?? "1 month",
                ),
            );
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to resume subscription",
            );
        } finally {
            setSubmitting(false);
        }
    }, [startCheckout, state?.subscription?.interval]);

    const handlePortal = useCallback(async () => {
        setPortalLoading(true);
        try {
            const res = await fetch("/api/billing/portal", {
                method: "POST",
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
                "Your subscription will end immediately without a prorated refund. All recordings, transcripts, and summaries will then be permanently removed. This cannot be undone. Export your data first if you want a copy.",
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

    const monthlyCatalog =
        (state.pricing.monthly.foundingAvailability?.remaining ?? 0) > 0
            ? state.pricing.monthly.founding
            : state.pricing.monthly.standard;
    const monthlyAvailable =
        monthlyCatalog.usd !== null || monthlyCatalog.eur !== null;
    const annualAvailable =
        state.pricing.annual.usd !== null || state.pricing.annual.eur !== null;
    const showIntervalPicker = monthlyAvailable && annualAvailable;
    const effectiveInterval: BillingInterval =
        interval === "year" && annualAvailable
            ? "year"
            : monthlyAvailable
              ? "month"
              : annualAvailable
                ? "year"
                : "month";

    const preferredCurrency = state.resolvedCurrency ?? "usd";
    const proPrice = formatProPrice(
        effectiveInterval === "year" ? state.pricing.annual : monthlyCatalog,
        effectiveInterval,
        preferredCurrency,
    );
    const foundingAvailability = state.pricing.monthly.foundingAvailability;
    const proPriceNote =
        effectiveInterval === "month" &&
        foundingAvailability &&
        foundingAvailability.remaining > 0
            ? `${foundingAvailability.remaining} founding monthly spot${foundingAvailability.remaining === 1 ? "" : "s"} left. Stripe confirms the exact charge before you subscribe.`
            : isTrial
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
                                    {subscriptionIntervalSuffix(sub.interval)}
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
                                `${formatSeconds(state.usage.monthlyMynahSecondsRemaining)} left this cycle`,
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
                            {showIntervalPicker && (
                                <fieldset className="inline-flex rounded-md border p-0.5">
                                    <legend className="sr-only">
                                        Billing interval
                                    </legend>
                                    {(
                                        [
                                            ["month", "Monthly"],
                                            ["year", "Annual"],
                                        ] as const
                                    ).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setInterval(value)}
                                            aria-pressed={
                                                effectiveInterval === value
                                            }
                                            className={cn(
                                                "rounded px-3 py-1 text-xs font-medium transition-colors",
                                                effectiveInterval === value
                                                    ? "bg-primary/10 text-primary"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </fieldset>
                            )}
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
                                    15 hours of Mynah transcription every 30
                                    days
                                </li>
                                <li>Unlimited devices, background sync</li>
                            </ul>
                            <div className="space-y-3 rounded-md border p-3">
                                <div className="flex items-start gap-2">
                                    <input
                                        id="business-purchase"
                                        type="checkbox"
                                        checked={buyingAsBusiness}
                                        onChange={(event) =>
                                            setBuyingAsBusiness(
                                                event.target.checked,
                                            )
                                        }
                                        className="mt-0.5 size-4 rounded border-input"
                                    />
                                    <Label
                                        htmlFor="business-purchase"
                                        className="text-sm"
                                    >
                                        Buying as an EU business
                                    </Label>
                                </div>
                                {buyingAsBusiness && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="business-name">
                                                Legal business name
                                            </Label>
                                            <Input
                                                id="business-name"
                                                value={businessName}
                                                onChange={(event) =>
                                                    setBusinessName(
                                                        event.target.value,
                                                    )
                                                }
                                                autoComplete="organization"
                                                maxLength={200}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="business-vat-id">
                                                EU VAT ID
                                            </Label>
                                            <Input
                                                id="business-vat-id"
                                                value={businessVatId}
                                                onChange={(event) =>
                                                    setBusinessVatId(
                                                        event.target.value,
                                                    )
                                                }
                                                autoComplete="off"
                                                placeholder="DE123456789"
                                                maxLength={32}
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground sm:col-span-2">
                                            Stripe verifies the VAT ID before
                                            checkout. Eligible cross-border EU
                                            purchases use reverse charge.
                                        </p>
                                    </div>
                                )}
                            </div>
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
                                onClick={() =>
                                    handleSubscribe(effectiveInterval)
                                }
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

                <SettingsCard title="Delete account">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="max-w-xl">
                            <p className="text-sm text-muted-foreground">
                                Export your data first. Deletion ends any active
                                subscription immediately without a prorated
                                refund, then permanently removes your account
                                and its data.
                            </p>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleDeleteNow}
                            disabled={submitting}
                        >
                            Delete account
                        </Button>
                    </div>
                </SettingsCard>
            </div>
        </div>
    );
}
