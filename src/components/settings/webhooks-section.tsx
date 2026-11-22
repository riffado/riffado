"use client";

import { formatDistanceToNow } from "date-fns";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsRowsSkeleton } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { toast } from "@/lib/toast";
import { WebhookDeliveriesDialog } from "./webhook-deliveries-dialog";
import { WebhookEditorDialog } from "./webhook-editor-dialog";
import { DEFAULT_WEBHOOK_EVENTS, type WebhookEndpoint } from "./webhook-types";

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
        <SettingsGroup
            title="Webhooks"
            description="Tell another app when something happens, like a transcript being ready"
            action={
                <Button
                    variant="quiet"
                    size="compact"
                    onClick={() => openEditor(null)}
                >
                    <Plus />
                    Add webhook
                </Button>
            }
        >
            {isLoading ? (
                <SettingsRowsSkeleton rows={1} />
            ) : webhooks.length === 0 ? (
                <p className="border-y border-hairline py-4 text-ui text-subtle">
                    No webhooks yet
                </p>
            ) : (
                <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                    {webhooks.map((webhook) => (
                        <WebhookRow
                            key={webhook.id}
                            webhook={webhook}
                            onEdit={openEditor}
                            onDelete={handleDelete}
                            onShowDeliveries={setDeliveryWebhook}
                        />
                    ))}
                </ul>
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
        </SettingsGroup>
    );
}

/** "transcription.completed" -> "Transcription completed". */
function eventLabel(event: string): string {
    const words = event.replace(/[._]/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventsSummary(events: string[]): string {
    const labels = events.map(eventLabel);
    if (labels.length <= 3) return labels.join(" · ");
    return `${labels.slice(0, 2).join(" · ")} and ${labels.length - 2} more`;
}

function deliveryLine(webhook: WebhookEndpoint): string {
    if (!webhook.lastDeliveryAt) return "Never delivered";
    const when = formatDistanceToNow(new Date(webhook.lastDeliveryAt), {
        addSuffix: true,
    });
    return webhook.lastDeliveryStatus === "failed"
        ? `Last delivery failed ${when}`
        : `Last delivered ${when}`;
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
    const tone = !webhook.enabled
        ? "idle"
        : webhook.lastDeliveryStatus === "failed"
          ? "attention"
          : "ready";
    return (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-4">
                <StatusDot tone={tone} />
                <div className="flex min-w-0 flex-col gap-0.5">
                    {webhook.description && (
                        <span className="truncate text-row font-semibold text-strong">
                            {webhook.description}
                        </span>
                    )}
                    <span className="truncate font-mono text-small leading-4 text-strong">
                        {webhook.url}
                    </span>
                    <span className="text-small leading-4 text-subtle">
                        {webhook.enabled ? "" : "Paused · "}
                        {eventsSummary(webhook.events)}
                    </span>
                </div>
            </div>
            <span className="text-small leading-4 text-subtle">
                {deliveryLine(webhook)}
            </span>
            <div className="flex shrink-0 items-center gap-1">
                <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => onShowDeliveries(webhook)}
                >
                    Deliveries
                </Button>
                <Button
                    variant="ghost"
                    size="icon-compact"
                    onClick={() => onEdit(webhook)}
                    aria-label="Edit webhook"
                >
                    <Pencil />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-compact"
                    onClick={() => onDelete(webhook.id)}
                    aria-label="Delete webhook"
                >
                    <Trash2 />
                </Button>
            </div>
        </li>
    );
}
