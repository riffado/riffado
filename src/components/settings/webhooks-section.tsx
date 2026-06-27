"use client";

import { Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Button } from "@/components/ui/button";
import { WebhookDeliveriesDialog } from "./webhook-deliveries-dialog";
import { WebhookEditorDialog } from "./webhook-editor-dialog";
import {
    DEFAULT_WEBHOOK_EVENTS,
    formatWebhookDate,
    type WebhookEndpoint,
} from "./webhook-types";

export function WebhooksSection() {
    const confirm = useConfirm();
    const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
    const [events, setEvents] = useState<string[]>(DEFAULT_WEBHOOK_EVENTS);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingWebhook, setEditingWebhook] =
        useState<WebhookEndpoint | null>(null);
    const [deliveryWebhook, setDeliveryWebhook] =
        useState<WebhookEndpoint | null>(null);

    const refreshWebhooks = useCallback(async () => {
        try {
            const response = await fetch("/api/settings/webhooks");
            if (!response.ok) throw new Error("Failed to fetch webhooks");
            const data = (await response.json()) as {
                webhooks: WebhookEndpoint[];
                events: string[];
            };
            setWebhooks(data.webhooks);
            setEvents(data.events);
        } catch {
            toast.error("Failed to load webhooks");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshWebhooks();
    }, [refreshWebhooks]);

    const openEditor = (webhook: WebhookEndpoint | null) => {
        setEditingWebhook(webhook);
        setIsEditorOpen(true);
    };

    const handleDelete = (webhookId: string) => {
        void confirm({
            title: "Delete this webhook?",
            description:
                "Deliveries will stop immediately. You'll have to recreate the endpoint and re-share its signing secret with any consumers.",
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
                const response = await fetch(
                    `/api/settings/webhooks/${webhookId}`,
                    { method: "DELETE" },
                );
                if (!response.ok) throw new Error("Failed to delete webhook");
                toast.success("Webhook deleted");
                await refreshWebhooks();
            },
            errorMessage: "Failed to delete webhook",
        });
    };

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title="Webhooks"
                description="Outbound HTTP notifications for recording, transcript, and summary events."
                icon={Webhook}
                action={
                    <Button size="sm" onClick={() => openEditor(null)}>
                        <Plus className="size-4" />
                        Add Webhook
                    </Button>
                }
            />

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
            ) : webhooks.length === 0 ? (
                <div className="text-center py-12 border rounded-lg">
                    <Webhook className="size-12 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-2">No webhooks</h3>
                    <Button size="sm" onClick={() => openEditor(null)}>
                        <Plus className="size-4" />
                        Add Webhook
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {webhooks.map((webhook) => (
                        <WebhookRow
                            key={webhook.id}
                            webhook={webhook}
                            onEdit={openEditor}
                            onDelete={handleDelete}
                            onShowDeliveries={setDeliveryWebhook}
                        />
                    ))}
                </div>
            )}

            <WebhookEditorDialog
                open={isEditorOpen}
                onOpenChange={setIsEditorOpen}
                editingWebhook={editingWebhook}
                events={events}
                onSaved={refreshWebhooks}
            />

            <WebhookDeliveriesDialog
                webhook={deliveryWebhook}
                onClose={() => setDeliveryWebhook(null)}
            />
        </div>
    );
}

/**
 * One row in the webhook list. Pure presentation -- all mutation goes
 * through the callbacks the parent owns.
 */
function WebhookRow({
    webhook,
    onEdit,
    onDelete,
    onShowDeliveries,
}: {
    webhook: WebhookEndpoint;
    onEdit: (webhook: WebhookEndpoint) => void;
    onDelete: (webhookId: string) => void;
    onShowDeliveries: (webhook: WebhookEndpoint) => void;
}) {
    return (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="min-w-0 truncate font-medium">
                        {webhook.description || webhook.url}
                    </h3>
                    <span
                        className={`rounded border px-2 py-0.5 text-xs ${
                            webhook.enabled
                                ? "text-primary"
                                : "text-muted-foreground"
                        }`}
                    >
                        {webhook.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {webhook.lastDeliveryStatus && (
                        <span className="rounded border px-2 py-0.5 text-xs">
                            {webhook.lastDeliveryStatus}
                        </span>
                    )}
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">
                    {webhook.url}
                </p>
                <div className="flex flex-wrap gap-1">
                    {webhook.events.map((event) => (
                        <span
                            key={event}
                            className="rounded bg-muted px-2 py-0.5 text-xs"
                        >
                            {event}
                        </span>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    Last delivery: {formatWebhookDate(webhook.lastDeliveryAt)}
                </p>
            </div>
            <div className="flex shrink-0 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onShowDeliveries(webhook)}
                >
                    Deliveries
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onEdit(webhook)}
                    aria-label="Edit webhook"
                >
                    <Pencil className="size-4" />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onDelete(webhook.id)}
                    aria-label="Delete webhook"
                >
                    <Trash2 className="size-4 text-destructive" />
                </Button>
            </div>
        </div>
    );
}
