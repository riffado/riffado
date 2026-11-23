"use client";

import { Lock, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
    Checkbox,
    DialogHeading,
    dialogInputClass,
    monoInputClass,
    OptionalLabel,
    ReadOnlyCode,
    SecretOnce,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { webhookEventLabel } from "@/components/settings/webhook-events";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { getApiErrorMessage, parseApiError } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { DEFAULT_WEBHOOK_EVENTS, type WebhookEndpoint } from "./webhook-types";

interface WebhookForm {
    url: string;
    description: string;
    enabled: boolean;
    events: string[];
}

function buildForm(
    webhook: WebhookEndpoint | null,
    events: string[],
): WebhookForm {
    if (webhook) {
        return {
            url: webhook.url,
            description: webhook.description || "",
            enabled: webhook.enabled,
            events: webhook.events,
        };
    }
    return {
        url: "",
        description: "",
        enabled: true,
        events: [events[0] ?? DEFAULT_WEBHOOK_EVENTS[0]],
    };
}

interface FormErrors {
    url?: string;
    events?: string;
    form?: string;
}

/** Which field a server validation message belongs to. */
export function webhookErrorField(message: string): keyof FormErrors {
    const lower = message.toLowerCase();
    if (lower.includes("event")) return "events";
    if (lower.includes("url") || lower.includes("host")) return "url";
    return "form";
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When non-null, the dialog edits this webhook; otherwise it creates. */
    editingWebhook: WebhookEndpoint | null;
    /** Server-known event list (subset of DEFAULT_WEBHOOK_EVENTS in practice). */
    events: string[];
    /** Called after a save or delete so the parent can re-fetch the list. */
    onSaved: () => Promise<void> | void;
}

/**
 * Add or edit a webhook: address, optional name, the events in plain
 * words (event id in mono), and whether it sends. After adding, the
 * dialog shows the signing secret once; edits only show it masked.
 */
export function WebhookEditorDialog({
    open,
    onOpenChange,
    editingWebhook,
    events,
    onSaved,
}: Props) {
    const confirm = useConfirm();
    const enabledId = useId();
    const [form, setForm] = useState<WebhookForm>(() =>
        buildForm(editingWebhook, events),
    );
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSaving, setIsSaving] = useState(false);
    const [createdSecret, setCreatedSecret] = useState<string | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: seed when the dialog opens, not when the list refreshes behind it (that would drop a new secret)
    useEffect(() => {
        if (open) {
            setCreatedSecret(null);
            setErrors({});
            setForm(buildForm(editingWebhook, events));
        }
    }, [open, editingWebhook]);

    const toggleEvent = (event: string, checked: boolean) => {
        setErrors((current) => ({ ...current, events: undefined }));
        setForm((current) => ({
            ...current,
            events: checked
                ? [...current.events.filter((e) => e !== event), event]
                : current.events.filter((e) => e !== event),
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const found: FormErrors = {};
        if (!form.url.trim()) {
            found.url = "Enter the address Riffado should post to";
        }
        if (form.events.length === 0) {
            found.events = "Pick at least one event";
        }
        if (found.url || found.events) {
            setErrors(found);
            return;
        }
        setIsSaving(true);
        setErrors({});
        try {
            const response = await fetch(
                editingWebhook
                    ? `/api/settings/webhooks/${editingWebhook.id}`
                    : "/api/settings/webhooks",
                {
                    method: editingWebhook ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...form, url: form.url.trim() }),
                },
            );
            if (!response.ok) {
                const body = await parseApiError(response);
                const message = body.error || "Couldn't save the webhook";
                setErrors({ [webhookErrorField(message)]: message });
                return;
            }
            const data = (await response.json()) as {
                webhook?: WebhookEndpoint;
                secret?: string;
            };
            await onSaved();
            if (data.secret) {
                setCreatedSecret(data.secret);
            } else {
                toast.success("Webhook saved");
                onOpenChange(false);
            }
        } catch {
            setErrors({
                form: "Couldn't reach Riffado. Check your connection, then try again",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const remove = () => {
        if (!editingWebhook) return;
        const label = editingWebhook.description || editingWebhook.url;
        void confirm({
            title: "Delete this webhook?",
            description: (
                <>
                    Riffado stops posting to{" "}
                    <span className="font-medium break-all text-strong">
                        {label}
                    </span>{" "}
                    right away. To use it again, add it again and copy the new
                    signing secret into the app that receives it.
                </>
            ),
            confirmLabel: "Delete webhook",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
                const response = await fetch(
                    `/api/settings/webhooks/${editingWebhook.id}`,
                    { method: "DELETE" },
                );
                if (!response.ok) {
                    throw new Error(
                        await getApiErrorMessage(
                            response,
                            "Couldn't delete the webhook",
                        ),
                    );
                }
                toast.success("Webhook deleted");
                onOpenChange(false);
                await onSaved();
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    settingsDialogClass,
                    createdSecret && "sm:max-w-120",
                )}
                onCloseAutoFocus={() => setCreatedSecret(null)}
            >
                {createdSecret ? (
                    <div className="flex flex-col gap-5">
                        <DialogHeading
                            title="Copy the signing secret"
                            description="Webhook added. Paste this into the app that receives it"
                        />
                        <SecretOnce
                            value={createdSecret}
                            copiedMessage="Secret copied"
                        />
                        <div className="flex flex-col gap-1.5">
                            <p className="text-sm leading-5 font-medium text-strong">
                                Each request carries a signature made with it
                            </p>
                            <ReadOnlyCode>
                                X-Riffado-Signature: t=…,v1=…
                            </ReadOnlyCode>
                            <p className="text-small text-muted-foreground">
                                Lost it? Delete the webhook and add it again.
                            </p>
                        </div>
                        <div className="flex justify-end pt-1">
                            <Button
                                type="button"
                                variant="bordered"
                                size="dialog"
                                onClick={() => onOpenChange(false)}
                            >
                                Done
                            </Button>
                        </div>
                    </div>
                ) : (
                    <form
                        onSubmit={handleSubmit}
                        noValidate
                        className="flex flex-col gap-5"
                    >
                        <DialogHeading
                            title={
                                editingWebhook ? "Edit webhook" : "Add webhook"
                            }
                            description="Riffado posts to this address when something you pick happens"
                        />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                            <Field
                                label="Address"
                                error={errors.url}
                                className="sm:flex-[1.7]"
                            >
                                <FieldInput
                                    type="url"
                                    inputMode="url"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus={!editingWebhook}
                                    placeholder="https://example.com/webhook"
                                    value={form.url}
                                    disabled={isSaving}
                                    onChange={(event) => {
                                        const url = event.target.value;
                                        setErrors((current) => ({
                                            ...current,
                                            url: undefined,
                                        }));
                                        setForm((current) => ({
                                            ...current,
                                            url,
                                        }));
                                    }}
                                    className={cn(
                                        dialogInputClass,
                                        monoInputClass,
                                    )}
                                />
                            </Field>
                            <Field
                                label={<OptionalLabel>Name</OptionalLabel>}
                                className="sm:flex-1"
                            >
                                <FieldInput
                                    autoComplete="off"
                                    placeholder="n8n automations"
                                    value={form.description}
                                    disabled={isSaving}
                                    onChange={(event) => {
                                        const description = event.target.value;
                                        setForm((current) => ({
                                            ...current,
                                            description,
                                        }));
                                    }}
                                    className={dialogInputClass}
                                />
                            </Field>
                        </div>

                        <fieldset className="flex min-w-0 flex-col gap-1.5">
                            <legend className="sr-only">Send when</legend>
                            <div
                                aria-hidden="true"
                                className="flex items-baseline justify-between gap-3"
                            >
                                <p className="text-sm leading-5 font-medium text-strong">
                                    Send when
                                </p>
                                <span className="text-xs leading-4 text-muted-foreground">
                                    {form.events.length} of {events.length}
                                </span>
                            </div>
                            <div
                                className={cn(
                                    "squircle flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border",
                                    errors.events &&
                                        "border-terracotta dark:border-terracotta-bright",
                                )}
                            >
                                {events.map((event) => (
                                    <EventRow
                                        key={event}
                                        event={event}
                                        checked={form.events.includes(event)}
                                        onCheckedChange={(checked) =>
                                            toggleEvent(event, checked)
                                        }
                                        disabled={isSaving}
                                    />
                                ))}
                            </div>
                            {errors.events && (
                                <FieldError role="alert">
                                    {errors.events}
                                </FieldError>
                            )}
                        </fieldset>

                        {editingWebhook && (
                            <div className="flex flex-col gap-1.5">
                                <p className="text-sm leading-5 font-medium text-strong">
                                    Signing secret
                                </p>
                                <div className="squircle flex h-10 items-center gap-2.5 rounded-[var(--radius-inner)] border border-hairline bg-surface px-3 dark:border-night-border dark:bg-night">
                                    <Lock
                                        aria-hidden="true"
                                        className="size-3.5 shrink-0 text-muted-foreground"
                                    />
                                    <span className="truncate font-mono text-small text-subtle">
                                        {editingWebhook.secret}
                                    </span>
                                </div>
                                <p className="text-small text-muted-foreground">
                                    Verifies the X-Riffado-Signature header. It
                                    was shown once, when you added this webhook.
                                </p>
                            </div>
                        )}

                        <label
                            htmlFor={enabledId}
                            className="flex cursor-pointer items-center gap-3 select-none"
                        >
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="text-ui leading-5 font-medium text-strong">
                                    Send events
                                </span>
                                <span className="text-xs leading-4 text-muted-foreground">
                                    Turn off to pause it without losing the
                                    setup
                                </span>
                            </span>
                            <SettingsSwitch
                                id={enabledId}
                                checked={form.enabled}
                                onCheckedChange={(checked) =>
                                    setForm((current) => ({
                                        ...current,
                                        enabled: checked,
                                    }))
                                }
                                disabled={isSaving}
                            />
                        </label>

                        {errors.form && (
                            <FieldError role="alert">{errors.form}</FieldError>
                        )}

                        <div
                            className={cn(
                                "flex flex-wrap items-center gap-2 pt-1",
                                editingWebhook
                                    ? "justify-between"
                                    : "justify-end",
                            )}
                        >
                            {editingWebhook && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="dialog"
                                    className="-ml-3 px-3"
                                    onClick={remove}
                                    disabled={isSaving}
                                >
                                    <Trash2 />
                                    Delete webhook
                                </Button>
                            )}
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="bordered"
                                    size="dialog"
                                    onClick={() => onOpenChange(false)}
                                    disabled={isSaving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    variant="ink"
                                    size="dialog"
                                    disabled={isSaving}
                                >
                                    {isSaving
                                        ? "Saving…"
                                        : editingWebhook
                                          ? "Save changes"
                                          : "Add webhook"}
                                </Button>
                            </div>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function EventRow({
    event,
    checked,
    onCheckedChange,
    disabled,
}: {
    event: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    const id = useId();
    return (
        <label
            htmlFor={id}
            className="flex min-h-9 cursor-pointer items-center gap-3 px-3.5 py-2 select-none"
        >
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(value) => onCheckedChange(value === true)}
                disabled={disabled}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 text-ui leading-5 text-strong">
                    {webhookEventLabel(event)}
                </span>
                <span className="font-mono text-xs leading-4 text-muted-foreground">
                    {event}
                </span>
            </span>
        </label>
    );
}
