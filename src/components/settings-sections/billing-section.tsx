"use client";

import {
    AlertTriangle,
    CreditCard,
    Download,
    ExternalLink,
    Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface BillingState {
    enabled: boolean;
    plan: "self_host" | "hosted_free" | "hosted_pro";
    planTransitionUntil: string | null;
    foundingMember: boolean;
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
    subscription: {
        id: string;
        status: string;
        nextPaymentAt: string | null;
        canceledAt: string | null;
        amountValue: string;
        amountCurrency: string;
    } | null;
}

function daysBetween(future: Date, now: Date): number {
    const ms = future.getTime() - now.getTime();
    if (ms <= 0) return 0;
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSeconds(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h === 0) return `${m} min`;
    return `${h}h ${m}m`;
}

function planLabel(plan: BillingState["plan"]): string {
    switch (plan) {
        case "hosted_pro":
            return "Hosted Pro";
        case "hosted_free":
            return "Lapsed (read-only)";
        case "self_host":
            return "Self-host";
    }
}

export function BillingSection() {
    const [state, setState] = useState<BillingState | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [waiver, setWaiver] = useState(false);
    const [submitting, setSubmitting] = useState(false);

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

    const handleSubscribe = useCallback(async () => {
        if (!waiver) {
            toast.error("Please confirm the consumer-law waiver to continue.");
            return;
        }
        setSubmitting(true);
        try {
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
                toast.success("Subscription reactivated");
                await load();
                return;
            }
            throw new Error("Unexpected checkout response");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Checkout failed");
        } finally {
            setSubmitting(false);
        }
    }, [waiver, load]);

    const handleDeleteNow = useCallback(async () => {
        if (
            !window.confirm(
                "Delete your account immediately? All recordings, transcripts, and summaries are permanently removed. This cannot be undone.",
            )
        ) {
            return;
        }
        setSubmitting(true);
        try {
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
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
        } finally {
            setSubmitting(false);
        }
    }, [load]);

    const handleCancel = useCallback(async () => {
        if (
            !window.confirm(
                "Cancel your subscription? You keep access through the end of your current paid period.",
            )
        ) {
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch("/api/billing/cancel", { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            toast.success("Subscription canceled");
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Cancel failed");
        } finally {
            setSubmitting(false);
        }
    }, [load]);

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

    const storageBar =
        state.entitlements.maxStorageBytes !== null
            ? Math.min(
                  100,
                  (state.usage.storageBytes /
                      state.entitlements.maxStorageBytes) *
                      100,
              )
            : 0;
    const mynahBar = state.entitlements.monthlyMynahSeconds
        ? Math.max(
              0,
              Math.min(
                  100,
                  (state.usage.monthlyMynahSecondsRemaining /
                      state.entitlements.monthlyMynahSeconds) *
                      100,
              ),
          )
        : 0;
    const isPro = state.plan === "hosted_pro";
    const inTransition =
        state.planTransitionUntil !== null &&
        new Date(state.planTransitionUntil) > new Date();

    const graceBanner =
        state.grace !== null ? (
            <SettingsCard>
                <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                    <div className="flex-1 space-y-2">
                        <div>
                            <h3 className="text-sm font-semibold text-foreground">
                                {state.grace.path === "trial"
                                    ? "Trial ended"
                                    : "Subscription ended"}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Your account is scheduled for permanent deletion
                                on{" "}
                                {new Date(
                                    state.grace.deletionAt,
                                ).toLocaleString()}{" "}
                                (in{" "}
                                {daysBetween(
                                    new Date(state.grace.deletionAt),
                                    new Date(),
                                )}{" "}
                                day(s)). Your recordings are still playable and
                                exportable. Sync from your device and new
                                transcriptions are paused.
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
                                {submitting && (
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                )}
                                Delete now
                            </Button>
                        </div>
                    </div>
                </div>
            </SettingsCard>
        ) : null;

    return (
        <>
            <SettingsSectionHeader
                icon={CreditCard}
                title="Billing"
                description="Manage your plan, usage, and subscription."
            />

            {graceBanner}

            <SettingsCard title="Plan">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-lg font-medium">
                            {planLabel(state.plan)}
                            {state.foundingMember && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                    Founding member
                                </span>
                            )}
                        </div>
                        {inTransition && state.planTransitionUntil && (
                            <p className="mt-1 text-sm text-muted-foreground">
                                Transition window active until{" "}
                                {new Date(
                                    state.planTransitionUntil,
                                ).toLocaleDateString()}{" "}
                                — Pro entitlements apply during this period.
                            </p>
                        )}
                        {state.subscription && (
                            <p className="mt-1 text-sm text-muted-foreground">
                                {state.subscription.amountValue}{" "}
                                {state.subscription.amountCurrency} ·{" "}
                                {state.subscription.status}
                                {state.subscription.nextPaymentAt &&
                                    ` · next billed ${new Date(state.subscription.nextPaymentAt).toLocaleDateString()}`}
                            </p>
                        )}
                    </div>
                </div>
            </SettingsCard>

            <SettingsCard title="Usage">
                <div className="space-y-4">
                    <div>
                        <div className="mb-1 flex items-center justify-between text-sm">
                            <span>Storage</span>
                            <span className="text-muted-foreground">
                                {formatBytes(state.usage.storageBytes)} /{" "}
                                {state.entitlements.maxStorageBytes !== null
                                    ? formatBytes(
                                          state.entitlements.maxStorageBytes,
                                      )
                                    : "∞"}
                            </span>
                        </div>
                        {state.entitlements.maxStorageBytes !== null && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-primary"
                                    style={{ width: `${storageBar}%` }}
                                />
                            </div>
                        )}
                    </div>
                    <div>
                        <div className="mb-1 flex items-center justify-between text-sm">
                            <span>Mynah transcription this cycle</span>
                            <span className="text-muted-foreground">
                                {formatSeconds(
                                    state.usage.monthlyMynahSecondsRemaining,
                                )}{" "}
                                left of{" "}
                                {formatSeconds(
                                    state.entitlements.monthlyMynahSeconds,
                                )}
                            </span>
                        </div>
                        {state.entitlements.monthlyMynahSeconds > 0 && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-primary"
                                    style={{ width: `${mynahBar}%` }}
                                />
                            </div>
                        )}
                        {state.usage.monthlyMynahGrantResetAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                                Next refresh{" "}
                                {new Date(
                                    state.usage.monthlyMynahGrantResetAt,
                                ).toLocaleString()}
                            </p>
                        )}
                    </div>
                </div>
            </SettingsCard>

            {!isPro ? (
                <SettingsCard title="Upgrade to Hosted Pro">
                    <div className="space-y-4">
                        <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                            <li>50 GB storage</li>
                            <li>15 hours of Mynah transcription per month</li>
                            <li>Unlimited devices, background sync</li>
                        </ul>
                        <div className="flex items-start gap-2">
                            <input
                                id="waiver"
                                type="checkbox"
                                checked={waiver}
                                onChange={(e) => setWaiver(e.target.checked)}
                                className="mt-0.5 size-4 rounded border-input"
                            />
                            <Label
                                htmlFor="waiver"
                                className="text-xs leading-snug text-muted-foreground"
                            >
                                I agree to immediate performance of the service
                                and waive the 14-day EU withdrawal right (Polish
                                art. 38 ust. 13 or local equivalent). The first
                                charge takes Pro live now and counts as
                                performance.
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
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Cancel keeps you on Pro until the end of the current
                            paid period
                            {state.subscription?.nextPaymentAt
                                ? ` (${new Date(state.subscription.nextPaymentAt).toLocaleDateString()})`
                                : ""}
                            . After that your account becomes read-only until
                            you resubscribe — your data stays put, but sync,
                            upload, and transcription pause. Free use lives in
                            self-host.
                        </p>
                        <Button
                            variant="destructive"
                            onClick={handleCancel}
                            disabled={submitting}
                        >
                            {submitting && (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                            )}
                            Cancel subscription
                        </Button>
                    </div>
                </SettingsCard>
            )}
        </>
    );
}
