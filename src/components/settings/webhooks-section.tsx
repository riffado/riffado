"use client";

import {
    Check,
    Clipboard,
    Pencil,
    Plus,
    RotateCcw,
    Trash2,
    Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type WebhookEndpoint = {
    id: string;
    url: string;
    secret: string;
    events: string[];
    description: string | null;
    enabled: boolean;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: string | null;
    createdAt: string;
};

type WebhookDelivery = {
    id: string;
    event: string;
    status: string;
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string;
    lastResponseStatus: number | null;
    lastError: string | null;
    createdAt: string;
};

const DEFAULT_EVENTS = [
    "recording.synced",
    "recording.updated",
    "recording.deleted",
    "transcription.completed",
    "transcription.failed",
];

function formatDate(value: string | null): string {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
}

function emptyForm(events = DEFAULT_EVENTS) {
    return {
        url: "",
        description: "",
        enabled: true,
        events: [events[0]],
    };
}

export function WebhooksSection() {
    const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
    const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingWebhook, setEditingWebhook] =
        useState<WebhookEndpoint | null>(null);
    const [form, setForm] = useState(emptyForm());
    const [createdSecret, setCreatedSecret] = useState<string | null>(null);
    const [deliveryWebhook, setDeliveryWebhook] =
        useState<WebhookEndpoint | null>(null);
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

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

    const refreshDeliveries = async (webhookId: string) => {
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
    };

    const openEditor = (webhook: WebhookEndpoint | null) => {
        setCreatedSecret(null);
        setEditingWebhook(webhook);
        setForm(
            webhook
                ? {
                      url: webhook.url,
                      description: webhook.description || "",
                      enabled: webhook.enabled,
                      events: webhook.events,
                  }
                : emptyForm(events),
        );
        setIsEditorOpen(true);
    };

    const toggleEvent = (event: string) => {
        setForm((current) => {
            const hasEvent = current.events.includes(event);
            const nextEvents = hasEvent
                ? current.events.filter((item) => item !== event)
                : [...current.events, event];
            return { ...current, events: nextEvents };
        });
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsSaving(true);

        try {
            const response = await fetch(
                editingWebhook
                    ? `/api/settings/webhooks/${editingWebhook.id}`
                    : "/api/settings/webhooks",
                {
                    method: editingWebhook ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                },
            );

            const data = (await response.json()) as {
                webhook?: WebhookEndpoint;
                secret?: string;
                error?: string;
            };
            if (!response.ok || !data.webhook) {
                throw new Error(data.error || "Failed to save webhook");
            }

            await refreshWebhooks();
            if (data.secret) {
                setCreatedSecret(data.secret);
            } else {
                setIsEditorOpen(false);
            }
            toast.success(editingWebhook ? "Webhook updated" : "Webhook added");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to save webhook",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (webhookId: string) => {
        if (!confirm("Delete this webhook?")) return;
        try {
            const response = await fetch(
                `/api/settings/webhooks/${webhookId}`,
                {
                    method: "DELETE",
                },
            );
            if (!response.ok) throw new Error("Failed to delete webhook");
            toast.success("Webhook deleted");
            await refreshWebhooks();
        } catch {
            toast.error("Failed to delete webhook");
        }
    };

    const copySecret = async () => {
        if (!createdSecret) return;
        await navigator.clipboard.writeText(createdSecret);
        toast.success("Secret copied");
    };

    const redeliver = async (deliveryId: string) => {
        if (!deliveryWebhook) return;
        try {
            const response = await fetch(
                `/api/settings/webhooks/${deliveryWebhook.id}/deliveries/${deliveryId}/redeliver`,
                { method: "POST" },
            );
            if (!response.ok) throw new Error("Failed to redeliver");
            toast.success("Delivery queued");
            await refreshDeliveries(deliveryWebhook.id);
        } catch {
            toast.error("Failed to queue delivery");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Webhook className="w-5 h-5" />
                    Webhooks
                </h2>
                <Button size="sm" onClick={() => openEditor(null)}>
                    <Plus className="w-4 h-4" />
                    Add Webhook
                </Button>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
            ) : webhooks.length === 0 ? (
                <div className="text-center py-12 border rounded-lg">
                    <Webhook className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-2">No webhooks</h3>
                    <Button size="sm" onClick={() => openEditor(null)}>
                        <Plus className="w-4 h-4" />
                        Add Webhook
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {webhooks.map((webhook) => (
                        <div
                            key={webhook.id}
                            className="space-y-3 rounded-lg border p-4"
                        >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                                            {webhook.enabled
                                                ? "Enabled"
                                                : "Disabled"}
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
                                        Last delivery:{" "}
                                        {formatDate(webhook.lastDeliveryAt)}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setDeliveryWebhook(webhook);
                                            refreshDeliveries(webhook.id);
                                        }}
                                    >
                                        Deliveries
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => openEditor(webhook)}
                                        aria-label="Edit webhook"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => handleDelete(webhook.id)}
                                        aria-label="Delete webhook"
                                    >
                                        <Trash2 className="w-4 h-4 text-destructive" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
                <DialogContent className="max-w-xl">
                    <DialogTitle>
                        {editingWebhook ? "Edit Webhook" : "Add Webhook"}
                    </DialogTitle>
                    {createdSecret ? (
                        <div className="space-y-4">
                            <DialogDescription>
                                This signing secret is shown once.
                            </DialogDescription>
                            <div className="rounded-md border bg-muted p-3 font-mono text-sm break-all">
                                {createdSecret}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={copySecret}
                                >
                                    <Clipboard className="w-4 h-4" />
                                    Copy
                                </Button>
                                <Button
                                    type="button"
                                    className="flex-1"
                                    onClick={() => {
                                        setCreatedSecret(null);
                                        setIsEditorOpen(false);
                                    }}
                                >
                                    <Check className="w-4 h-4" />
                                    Saved
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="webhook-url">URL</Label>
                                <Input
                                    id="webhook-url"
                                    value={form.url}
                                    onChange={(event) =>
                                        setForm((current) => ({
                                            ...current,
                                            url: event.target.value,
                                        }))
                                    }
                                    placeholder="https://example.com/webhook"
                                    disabled={isSaving}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="webhook-description">
                                    Description
                                </Label>
                                <Input
                                    id="webhook-description"
                                    value={form.description}
                                    onChange={(event) =>
                                        setForm((current) => ({
                                            ...current,
                                            description: event.target.value,
                                        }))
                                    }
                                    placeholder="Automation receiver"
                                    disabled={isSaving}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Events</Label>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {events.map((event) => (
                                        <label
                                            key={event}
                                            className="flex items-center gap-2 rounded-md border p-2 text-sm"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={form.events.includes(
                                                    event,
                                                )}
                                                onChange={() =>
                                                    toggleEvent(event)
                                                }
                                                disabled={
                                                    isSaving ||
                                                    (form.events.length === 1 &&
                                                        form.events.includes(
                                                            event,
                                                        ))
                                                }
                                            />
                                            <span>{event}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center justify-between rounded-md border p-3">
                                <Label htmlFor="webhook-enabled">Enabled</Label>
                                <Switch
                                    id="webhook-enabled"
                                    checked={form.enabled}
                                    onCheckedChange={(checked) =>
                                        setForm((current) => ({
                                            ...current,
                                            enabled: checked,
                                        }))
                                    }
                                    disabled={isSaving}
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsEditorOpen(false)}
                                    disabled={isSaving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={
                                        isSaving ||
                                        !form.url.trim() ||
                                        form.events.length === 0
                                    }
                                >
                                    Save
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog
                open={Boolean(deliveryWebhook)}
                onOpenChange={(open) => {
                    if (!open) setDeliveryWebhook(null);
                }}
            >
                <DialogContent className="max-w-3xl">
                    <DialogTitle>Webhook Deliveries</DialogTitle>
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
                                                    {
                                                        delivery.lastResponseStatus
                                                    }
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Attempts: {delivery.attempts} ·
                                            Last:{" "}
                                            {formatDate(delivery.lastAttemptAt)}
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
                                        onClick={() => redeliver(delivery.id)}
                                    >
                                        <RotateCcw className="w-4 h-4" />
                                        Redeliver
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
