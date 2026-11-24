"use client";

import { Download, ExternalLink, Loader2, Receipt } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { DotNumber, UsageReadout } from "@/components/settings/dot-meter";
import { shortBytes, splitBytes } from "@/components/settings/format-usage";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow, SettingsRows } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { FilterGroup } from "@/components/ui/filter-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { toast } from "@/lib/toast";

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
     * estimate below always matches what Stripe will actually charge.
     * Resolved separately per tier -- monthly (founding or standard,
     * whichever is currently active) and annual can have different
     * configured currency availability. */
    resolvedCurrency?: { monthly: "usd" | "eur"; annual: "usd" | "eur" };
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
                if (posthog.__loaded) {
                    posthog.capture("checkout_started", {
                        interval: checkoutInterval,
                    });
                }
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
                    if (posthog.__loaded) {
                        posthog.capture("subscription_canceled");
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
            <output
                className="flex flex-col gap-10"
                aria-busy="true"
                aria-label="Loading your plan"
            >
                <div className="h-15 w-72 animate-pulse rounded-[var(--radius-inner)] bg-surface" />
                <div className="squircle h-60 animate-pulse rounded-[var(--radius-card)] border border-hairline bg-surface" />
            </output>
        );
    }

    if (!state) {
        return (
            <SettingsCard
                description={loadError ?? "Failed to load billing state."}
                action={
                    <Button
                        variant="quiet"
                        size="compact"
                        onClick={() => void load()}
                    >
                        Try again
                    </Button>
                }
            />
        );
    }

    if (!state.enabled) {
        return (
            <SettingsCard
                title="Billing isn't set up on this server"
                description={
                    <>
                        Self-host instances run on the AGPL source with no paid
                        plan. To enable hosted billing, the operator must set{" "}
                        <code>BILLING_ENABLED=true</code> and
                        <code> STRIPE_SECRET_KEY</code>.
                    </>
                }
            />
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
                planName = "Riffado Pro";
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
        status = { label: "Self-hosted", tone: "idle" };
    } else if (isTrial) {
        status = { label: "Trial", tone: "working" };
    } else if (isLapsed) {
        status = { label: "Read-only", tone: "idle" };
    } else if (sub?.status === "past_due") {
        status = { label: "Past due", tone: "working" };
    } else if (cancelPending) {
        status = { label: "Canceling", tone: "working" };
    } else {
        status = { label: "Active", tone: "ready" };
    }

    const storageMax = state.entitlements.maxStorageBytes;
    const storageFraction =
        storageMax !== null && storageMax > 0
            ? state.usage.storageBytes / storageMax
            : null;
    const storageUsed = splitBytes(state.usage.storageBytes);
    const mynahTotal = state.entitlements.monthlyMynahSeconds;
    const mynahUsed = Math.max(
        0,
        mynahTotal - state.usage.monthlyMynahSecondsRemaining,
    );
    const mynahFraction = mynahTotal > 0 ? mynahUsed / mynahTotal : null;
    const mynahUsedHours = Math.floor(mynahUsed / 3600);
    const mynahUsedMinutes = Math.floor((mynahUsed % 3600) / 60);

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

    const preferredCurrency =
        (effectiveInterval === "year"
            ? state.resolvedCurrency?.annual
            : state.resolvedCurrency?.monthly) ?? "usd";
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

    const subscriptionLine =
        hasLiveSub && sub
            ? `${formatMoney(sub.amountValue, sub.amountCurrency)}${subscriptionIntervalSuffix(sub.interval)}${
                  cancelPending && sub.canceledAt
                      ? `, ends ${formatDate(sub.canceledAt)}`
                      : sub.nextPaymentAt
                        ? `, renews ${formatDate(sub.nextPaymentAt)}`
                        : ""
              }`
            : null;

    const portalButton = (
        <Button
            variant="quiet"
            size="compact"
            onClick={handlePortal}
            disabled={portalLoading}
        >
            {portalLoading ? <Loader2 className="animate-spin" /> : <Receipt />}
            Payment method & invoices
        </Button>
    );

    return (
        <div className="flex flex-col gap-10">
            {state.grace !== null && (
                <SettingsCard
                    title={
                        <span className="flex items-center gap-2">
                            <StatusDot tone="attention" />
                            {state.grace.path === "trial"
                                ? "Your trial has ended"
                                : "Your subscription has ended"}
                        </span>
                    }
                    description={
                        <>
                            Your account will be permanently deleted on{" "}
                            {formatDate(state.grace.deletionAt)} (in{" "}
                            {daysBetween(
                                new Date(state.grace.deletionAt),
                                new Date(),
                            )}{" "}
                            day(s)). Until then you can still play and export
                            your recordings; syncing and new transcriptions are
                            paused. Subscribe below to keep everything.
                        </>
                    }
                >
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="quiet"
                            size="compact"
                            onClick={() => {
                                window.location.hash = "export";
                            }}
                        >
                            <Download />
                            Export my data
                        </Button>
                        <Button
                            variant="destructive"
                            size="compact"
                            onClick={handleDeleteNow}
                            disabled={submitting}
                        >
                            Delete now
                        </Button>
                    </div>
                </SettingsCard>
            )}

            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-7">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <h2 className="font-display text-plan-title font-semibold text-strong">
                        {planName}
                    </h2>
                    <p className="flex items-center gap-2 text-row leading-5 text-strong">
                        <StatusDot tone={status.tone} />
                        {status.label}
                        {state.foundingMember && (
                            <span className="text-subtle">
                                · Founding member
                            </span>
                        )}
                    </p>
                    {subscriptionLine && (
                        <p className="text-row leading-5 text-subtle tabular-nums">
                            {subscriptionLine}
                        </p>
                    )}
                    {planNote && (
                        <p className="max-w-155 text-ui text-subtle">
                            {planNote}
                        </p>
                    )}
                    {hasLiveSub && sub?.status === "past_due" && (
                        <p className="max-w-155 text-ui text-strong">
                            Your last payment didn't go through. Update your
                            payment method to keep your subscription.
                        </p>
                    )}
                </div>
                {hasLiveSub && portalButton}
            </div>

            <SettingsGroup title="Usage">
                <SettingsCard
                    tone="quiet"
                    className="gap-0 divide-y divide-hairline py-0"
                >
                    {mynahTotal > 0 && (
                        <UsageReadout
                            label="Transcription with Mynah"
                            value={
                                <>
                                    {mynahUsedHours > 0 && (
                                        <>
                                            <DotNumber>
                                                {mynahUsedHours}
                                            </DotNumber>
                                            <span>h</span>
                                        </>
                                    )}
                                    <DotNumber>{mynahUsedMinutes}</DotNumber>
                                    <span>
                                        min of {formatSeconds(mynahTotal)} used
                                    </span>
                                </>
                            }
                            fraction={mynahFraction}
                            tone={
                                mynahFraction !== null && mynahFraction >= 0.9
                                    ? "warning"
                                    : "default"
                            }
                            meterLabel={`${formatSeconds(mynahUsed)} of ${formatSeconds(mynahTotal)} used`}
                            footer={[
                                `${formatSeconds(state.usage.monthlyMynahSecondsRemaining)} left this cycle`,
                                state.usage.monthlyMynahGrantResetAt
                                    ? `resets ${formatDate(state.usage.monthlyMynahGrantResetAt)}`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        />
                    )}
                    <UsageReadout
                        label="Storage"
                        value={
                            <>
                                <DotNumber>{storageUsed.value}</DotNumber>
                                <span>
                                    {storageUsed.unit}
                                    {storageMax === 0
                                        ? ""
                                        : ` of ${
                                              storageMax !== null
                                                  ? shortBytes(storageMax)
                                                  : "unlimited"
                                          }`}{" "}
                                    used
                                </span>
                            </>
                        }
                        fraction={storageFraction}
                        tone={
                            storageFraction !== null && storageFraction >= 0.9
                                ? "warning"
                                : "default"
                        }
                        meterLabel={`${shortBytes(state.usage.storageBytes)}${
                            storageMax === 0
                                ? ""
                                : ` of ${
                                      storageMax !== null
                                          ? shortBytes(storageMax)
                                          : "unlimited"
                                  }`
                        } used`}
                        footer={
                            storageMax !== null && storageMax > 0
                                ? `${shortBytes(Math.max(0, storageMax - state.usage.storageBytes))} free`
                                : null
                        }
                    />
                </SettingsCard>
            </SettingsGroup>

            {!hasLiveSub ? (
                <SettingsGroup
                    title={
                        isTrial
                            ? "Keep Pro after your trial"
                            : isLapsed && state.everPaidAt
                              ? "Resubscribe to Pro"
                              : "Upgrade to Pro"
                    }
                >
                    <SettingsCard>
                        <div className="flex flex-col gap-5">
                            {showIntervalPicker && (
                                <FilterGroup
                                    aria-label="Billing interval"
                                    value={effectiveInterval}
                                    onValueChange={setInterval}
                                    options={[
                                        { value: "month", label: "Monthly" },
                                        { value: "year", label: "Annual" },
                                    ]}
                                />
                            )}
                            <div className="flex flex-col gap-1">
                                <p className="font-display text-plan-title font-semibold text-strong tabular-nums">
                                    {proPrice}
                                </p>
                                <p className="text-ui text-subtle">
                                    {proPriceNote}
                                </p>
                            </div>
                            <ul className="ml-5 list-disc space-y-1 text-ui text-subtle">
                                <li>50 GB storage</li>
                                <li>
                                    15 hours of Mynah transcription every 30
                                    days
                                </li>
                                <li>Unlimited devices, background sync</li>
                            </ul>
                            <div className="squircle flex flex-col gap-3 rounded-[var(--radius-item)] bg-background p-4">
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
                                        className="mt-0.5 size-4 rounded border-input accent-ink"
                                    />
                                    <Label
                                        htmlFor="business-purchase"
                                        className="text-ui"
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
                                    className="mt-0.5 size-4 rounded border-input accent-ink"
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
                            <div>
                                <Button
                                    variant="ink"
                                    size="compact"
                                    onClick={() =>
                                        handleSubscribe(effectiveInterval)
                                    }
                                    disabled={!waiver || submitting}
                                >
                                    {submitting ? (
                                        <Loader2 className="animate-spin" />
                                    ) : (
                                        <ExternalLink />
                                    )}
                                    Subscribe via Stripe
                                </Button>
                            </div>
                        </div>
                    </SettingsCard>
                </SettingsGroup>
            ) : (
                <SettingsGroup title="Subscription">
                    <SettingsRows>
                        {cancelPending && sub?.canceledAt ? (
                            <SettingsRow
                                label="Ending soon"
                                description={`Ends on ${formatDate(sub.canceledAt)}. You keep full access until then. Resume any time before that date at no extra charge; your next payment simply continues as scheduled.`}
                                control={
                                    <Button
                                        variant="ink"
                                        size="compact"
                                        onClick={handleResume}
                                        disabled={submitting}
                                    >
                                        {submitting && (
                                            <Loader2 className="animate-spin" />
                                        )}
                                        Resume subscription
                                    </Button>
                                }
                            />
                        ) : (
                            <SettingsRow
                                label="Cancel subscription"
                                description="You keep full access until the end of the period you paid for"
                                control={
                                    <Button
                                        variant="quiet"
                                        size="compact"
                                        onClick={() =>
                                            handleCancel(
                                                sub?.nextPaymentAt ?? null,
                                            )
                                        }
                                    >
                                        Cancel subscription
                                    </Button>
                                }
                            />
                        )}
                    </SettingsRows>
                </SettingsGroup>
            )}

            <SettingsGroup title="Delete account">
                <SettingsRows>
                    <SettingsRow
                        label="Delete your account and data"
                        description="Export your data first. Deletion ends any active subscription right away without a prorated refund, then permanently removes your account and its data"
                        control={
                            <Button
                                variant="destructive"
                                size="compact"
                                onClick={handleDeleteNow}
                                disabled={submitting}
                            >
                                Delete account
                            </Button>
                        }
                    />
                </SettingsRows>
            </SettingsGroup>
        </div>
    );
}
