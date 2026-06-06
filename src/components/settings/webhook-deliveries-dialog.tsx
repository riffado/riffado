"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    formatWebhookDate,
    type WebhookDelivery,
    type WebhookEndpoint,
} from "./webhook-types";

interface Props {
    /** Webhook whose deliveries should be displayed; `null` closes the dialog. */
    webhook: WebhookEndpoint | null;
    onClose: () => void;
}

/**
 * Read-mostly deliveries inspector for a single webhook endpoint. Fetches
 * its own list whenever the `webhook` prop changes -- the parent doesn't
 * keep delivery state around, so opening the dialog from one webhook then
 * another never flashes the wrong endpoint's history.
 */
export function WebhookDeliveriesDialog({ webhook, onClose }: Props) {
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

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
        } catch {
            toast.error("Failed to load deliveries");
        }
    }, [webhookId]);

    useEffect(() => {
        if (!webhookId) {
            // Clear stale deliveries when the dialog closes so re-opening
            // it for a different webhook can't briefly flash the old list.
            setDeliveries([]);
            return;
        }
        void refresh();
    }, [webhookId, refresh]);

    const redeliver = async (deliveryId: string) => {
        if (!webhookId) return;
        try {
            const response = await fetch(
                `/api/settings/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`,
                { method: "POST" },
            );
            if (!response.ok) throw new Error("Failed to redeliver");
            toast.success("Delivery queued");
            await refresh();
        } catch {
            toast.error("Failed to queue delivery");
        }
    };

    return (
        <Dialog
            open={Boolean(webhook)}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="max-w-3xl">
                <DialogTitle>Webhook Deliveries</DialogTitle>
                <DialogDescription>
                    Recent delivery attempts for this webhook.
                </DialogDescription>
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                    {deliveries.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deliveries yet
                        </p>
                    ) : (
                        deliveries.map((delivery) => (
                            <div
                                key={delivery.id}
                                className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[1fr_auto]"
                            >
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">
                                            {delivery.event}
                                        </span>
                                        <span className="rounded border px-2 py-0.5 text-xs">
                                            {delivery.status}
                                        </span>
                                        {delivery.lastResponseStatus && (
                                            <span className="rounded border px-2 py-0.5 text-xs">
                                                HTTP{" "}
                                                {delivery.lastResponseStatus}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Attempts: {delivery.attempts} · Last:{" "}
                                        {formatWebhookDate(
                                            delivery.lastAttemptAt,
                                        )}
                                    </p>
                                    {delivery.lastError && (
                                        <p className="text-xs text-destructive">
                                            {delivery.lastError}
                                        </p>
                                    )}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={delivery.status === "processing"}
                                    onClick={() => redeliver(delivery.id)}
                                >
                                    <RotateCcw className="size-4" />
                                    Redeliver
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
