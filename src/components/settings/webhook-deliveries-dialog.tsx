"use client";

import { format, isToday, isYesterday } from "date-fns";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
    DialogHeading,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import {
    deliveryState,
    triesLabel,
    webhookEventLabel,
} from "@/components/settings/webhook-events";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { getApiErrorMessage } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { WebhookDelivery, WebhookEndpoint } from "./webhook-types";

interface Props {
    /** Webhook whose deliveries should be displayed; `null` closes the dialog. */
    webhook: WebhookEndpoint | null;
    onClose: () => void;
}

/** "09:41" today, "Yesterday 16:20", then "Mar 3 16:20". */
export function deliveryTime(value: string): string {
    const date = new Date(value);
    if (isToday(date)) return format(date, "HH:mm");
    if (isYesterday(date)) return `Yesterday ${format(date, "HH:mm")}`;
    return format(date, "MMM d HH:mm");
}

function detailLine(delivery: WebhookDelivery): string | null {
    if (delivery.status === "dead") {
        const reason = delivery.lastError
            ? ` The last one ended with: ${delivery.lastError}`
            : "";
        return `Gave up after ${triesLabel(delivery.attempts)}.${reason}`;
    }
    if (delivery.status === "pending" && delivery.attempts > 0) {
        return `Next try at ${format(new Date(delivery.nextAttemptAt), "HH:mm")}`;
    }
    return null;
}

type LoadState = "loading" | "ready" | "failed";

/**
 * Deliveries for one webhook: a dot and a word for the status, the event
 * in words with its id in mono, the response code, when it was sent and
 * how many tries it took, and Redeliver. Fetches its own list whenever
 * the `webhook` prop changes, so opening it for another webhook never
 * flashes the previous history.
 */
export function WebhookDeliveriesDialog({ webhook, onClose }: Props) {
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
    const [loadState, setLoadState] = useState<LoadState>("loading");
    const [redelivering, setRedelivering] = useState<string | null>(null);

    const webhookId = webhook?.id ?? null;

    const refresh = useCallback(async () => {
        if (!webhookId) return;
        try {
            const response = await fetch(
                `/api/settings/webhooks/${webhookId}/deliveries`,
            );
            if (!response.ok) throw new Error("Failed to fetch deliveries");
            const data = (await response.json()) as {
                deliveries: WebhookDelivery[];
            };
            setDeliveries(data.deliveries);
            setLoadState("ready");
        } catch {
            setLoadState("failed");
        }
    }, [webhookId]);

    useEffect(() => {
        if (!webhookId) {
            setDeliveries([]);
            setLoadState("loading");
            return;
        }
        void refresh();
    }, [webhookId, refresh]);

    const redeliver = async (deliveryId: string) => {
        if (!webhookId) return;
        setRedelivering(deliveryId);
        try {
            const response = await fetch(
                `/api/settings/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`,
                { method: "POST" },
            );
            if (!response.ok) {
                throw new Error(
                    await getApiErrorMessage(response, "Couldn't redeliver"),
                );
            }
            toast.success("Queued to send again");
            await refresh();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Couldn't redeliver",
            );
        } finally {
            setRedelivering(null);
        }
    };

    const paused = webhook ? !webhook.enabled : false;

    return (
        <Dialog
            open={Boolean(webhook)}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className={cn(settingsDialogClass, "sm:max-w-180")}>
                <DialogHeading
                    title="Deliveries"
                    description={
                        webhook ? (
                            <>
                                {webhook.description
                                    ? `${webhook.description} · `
                                    : null}
                                <span className="font-mono text-small break-all">
                                    {webhook.url}
                                </span>
                            </>
                        ) : null
                    }
                />

                {paused && (
                    <p className="text-small text-subtle">
                        Paused. Turn on Send events for this webhook to send or
                        redeliver anything
                    </p>
                )}

                {loadState === "loading" && <DeliveriesSkeleton />}

                {loadState === "failed" && (
                    <div className="flex flex-col items-start gap-3 border-y border-border py-6">
                        <p className="text-ui text-strong">
                            Couldn't load the deliveries
                        </p>
                        <Button
                            variant="quiet"
                            size="compact"
                            onClick={() => {
                                setLoadState("loading");
                                void refresh();
                            }}
                        >
                            Try again
                        </Button>
                    </div>
                )}

                {loadState === "ready" && deliveries.length === 0 && (
                    <div className="flex flex-col gap-1 border-y border-border py-6">
                        <p className="text-ui font-medium text-strong">
                            No deliveries yet
                        </p>
                        <p className="text-small text-subtle">
                            They show up here once something you picked happens
                        </p>
                    </div>
                )}

                {loadState === "ready" && deliveries.length > 0 && (
                    <div className="flex flex-col">
                        <div
                            aria-hidden="true"
                            className="flex items-center gap-4 border-b border-border px-2.5 pb-2 text-xs leading-4 font-medium text-muted-foreground max-sm:hidden"
                        >
                            <span className="w-24 shrink-0">Status</span>
                            <span className="min-w-0 flex-1">Event</span>
                            <span className="w-16 shrink-0">Response</span>
                            <span className="w-28 shrink-0 text-right">
                                Sent
                            </span>
                            <span className="w-28 shrink-0" />
                        </div>
                        <ul className="flex flex-col">
                            {deliveries.map((delivery) => (
                                <DeliveryRow
                                    key={delivery.id}
                                    delivery={delivery}
                                    canRedeliver={!paused}
                                    pending={redelivering === delivery.id}
                                    onRedeliver={() =>
                                        void redeliver(delivery.id)
                                    }
                                />
                            ))}
                        </ul>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function DeliveryRow({
    delivery,
    canRedeliver,
    pending,
    onRedeliver,
}: {
    delivery: WebhookDelivery;
    canRedeliver: boolean;
    pending: boolean;
    onRedeliver: () => void;
}) {
    const state = deliveryState(delivery);
    const detail = detailLine(delivery);
    const needsAttention =
        delivery.status === "dead" ||
        (delivery.status === "pending" && delivery.attempts > 0);
    const showRedeliver = canRedeliver && delivery.status !== "processing";
    return (
        <li className="group flex flex-col gap-1 border-b border-border px-2.5 py-3 transition-colors duration-150 ease-[ease] last:border-b-0 hover:bg-accent/60 dark:hover:bg-night-border/40">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex w-24 shrink-0 items-center gap-2">
                    <StatusDot tone={state.tone} />
                    <span className="text-ui leading-5 font-medium text-strong">
                        {state.label}
                    </span>
                </span>
                <span className="flex min-w-0 flex-1 basis-40 flex-col gap-px">
                    <span className="text-ui leading-5 text-strong">
                        {webhookEventLabel(delivery.event)}
                    </span>
                    <span className="font-mono text-xs leading-4 text-muted-foreground">
                        {delivery.event}
                    </span>
                </span>
                <span className="w-16 shrink-0 font-mono text-small text-foreground max-sm:w-auto">
                    <span className="sr-only">Response </span>
                    {delivery.lastResponseStatus ?? "—"}
                </span>
                <span className="flex w-28 shrink-0 flex-col items-end gap-px max-sm:w-auto max-sm:flex-row max-sm:gap-2">
                    <span className="text-small text-foreground tabular-nums">
                        {deliveryTime(delivery.createdAt)}
                    </span>
                    <span className="text-xs leading-4 text-muted-foreground">
                        {triesLabel(delivery.attempts)}
                    </span>
                </span>
                <span className="flex w-28 shrink-0 justify-end max-sm:ml-auto max-sm:w-auto">
                    {showRedeliver && (
                        <Button
                            variant={needsAttention ? "bordered" : "ghost"}
                            size="compact"
                            onClick={onRedeliver}
                            disabled={pending}
                            className={cn(
                                !needsAttention &&
                                    "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
                            )}
                        >
                            <RotateCcw />
                            {pending ? "Queuing…" : "Redeliver"}
                        </Button>
                    )}
                </span>
            </div>
            {detail && (
                <p className="text-small text-subtle sm:pl-28">{detail}</p>
            )}
        </li>
    );
}

function DeliveriesSkeleton() {
    return (
        <output
            aria-busy="true"
            aria-label="Loading deliveries"
            className="flex flex-col divide-y divide-border border-y border-border"
        >
            {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-16 items-center gap-4 px-2.5">
                    <div className="h-3.5 w-20 animate-pulse rounded-full bg-surface" />
                    <div className="h-3.5 w-48 animate-pulse rounded-full bg-surface" />
                </div>
            ))}
        </output>
    );
}
