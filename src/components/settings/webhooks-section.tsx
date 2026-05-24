"use client";

import { Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
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
    const t = useTranslations("settings.webhooks");
    const tCommon = useTranslations("common");
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
            toast.error(t("loadFailed"));
        } finally {
            setIsLoading(false);
        }
    }, [t]);

    useEffect(() => {
        refreshWebhooks();
    }, [refreshWebhooks]);

    const openEditor = (webhook: WebhookEndpoint | null) => {
        setEditingWebhook(webhook);
        setIsEditorOpen(true);
    };

    const handleDelete = (webhookId: string) => {
        void confirm({
            title: t("deleteConfirmTitle"),
            description: t("deleteConfirmBody"),
            confirmLabel: tCommon("delete"),
            pendingLabel: tCommon("deleting"),
            destructive: true,
            onConfirm: async () => {
                const response = await fetch(
                    `/api/settings/webhooks/${webhookId}`,
                    { method: "DELETE" },
                );
                if (!response.ok) throw new Error("Failed to delete webhook");
                toast.success(t("deletedToast"));
                await refreshWebhooks();
            },
            errorMessage: t("deleteFailed"),
        });
    };

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title={t("title")}
                description={t("description")}
                icon={Webhook}
                action={
                    <Button size="sm" onClick={() => openEditor(null)}>
                        <Plus className="size-4" />
                        {t("addWebhook")}
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
                    <h3 className="font-semibold mb-2">
                        {t("noWebhooksTitle")}
                    </h3>
                    <Button size="sm" onClick={() => openEditor(null)}>
                        <Plus className="size-4" />
                        {t("addWebhook")}
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
                    {/*
                      Always-visible Add button at the foot of the list.
                      The section header's action slot is the primary
                      affordance, but the Settings dialog clamps to
                      `lg:max-w-[900px]` with `overflow-hidden`, and on
                      narrow panes the header's right-side action can
                      collide with the dialog's close button or get
                      clipped — leaving the user unable to add a second
                      webhook. This bottom button is a guaranteed escape
                      hatch that mirrors the empty-state CTA.
                    */}
                    <div className="pt-1">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditor(null)}
                        >
                            <Plus className="size-4" />
                            {t("addWebhook")}
                        </Button>
                    </div>
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
    const t = useTranslations("settings.webhooks");
    return (
        <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-3">
                <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-medium">
                            {webhook.description || webhook.url}
                        </h3>
                        <span
                            className={`rounded border px-2 py-0.5 text-xs ${
                                webhook.enabled
                                    ? "text-primary"
                                    : "text-muted-foreground"
                            }`}
                        >
                            {webhook.enabled ? t("enabled") : t("disabled")}
                        </span>
                        {webhook.lastDeliveryStatus && (
                            <span className="rounded border px-2 py-0.5 text-xs">
                                {webhook.lastDeliveryStatus}
                            </span>
                        )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">
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
                        {webhook.lastDeliveryAt
                            ? t("lastDelivery", {
                                  time: formatWebhookDate(
                                      webhook.lastDeliveryAt,
                                  ),
                              })
                            : t("lastDeliveryNever")}
                    </p>
                </div>
                {/*
                  Always stacked below the row content (never side-by-side):
                  the Settings dialog clamps the main pane to ~550–650 px on
                  `md:max-w-[800px]` / `lg:max-w-[900px]`, and the previous
                  `sm:flex-row sm:justify-between` triggered at 640 px viewport
                  — which is wider than the actual pane. Result: Deliveries +
                  Edit + Delete pushed off the right edge with no way to
                  reach them. `flex-wrap` covers the extreme-narrow case
                  (mobile-portrait) where three buttons + gaps still exceed
                  the pane width.
                */}
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onShowDeliveries(webhook)}
                    >
                        {t("deliveries")}
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onEdit(webhook)}
                        aria-label={t("editWebhook")}
                    >
                        <Pencil className="size-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onDelete(webhook.id)}
                        aria-label={t("deleteWebhook")}
                    >
                        <Trash2 className="size-4 text-destructive" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
