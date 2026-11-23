"use client";

import { addDays, format, startOfDay } from "date-fns";
import { Eye } from "lucide-react";
import { useId, useState } from "react";
import {
    ChoiceChips,
    DialogHeading,
    dialogInputClass,
    InfoNote,
    ReadOnlyCode,
    SecretOnce,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { parseApiError } from "@/lib/api-errors";

/** An API key as the settings list shows it (`/api/settings/api-keys`). */
export type ApiKey = {
    id: string;
    name: string;
    keyPrefix: string;
    source: "manual" | "device-flow";
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
};

export type ExpiryChoice = "30d" | "90d" | "1y" | "never" | "date";

const EXPIRY_OPTIONS: readonly { value: ExpiryChoice; label: string }[] = [
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
    { value: "1y", label: "1 year" },
    { value: "never", label: "Never" },
    { value: "date", label: "Pick a date" },
];

/**
 * When a key made now stops working, or null for no expiry. Chips count
 * from `now`; a picked date (`yyyy-MM-dd`) ends at the start of that day
 * in the browser's time zone. An empty pick is `undefined` (not chosen).
 */
export function expiryDate(
    choice: ExpiryChoice,
    picked: string,
    now: Date,
): Date | null | undefined {
    switch (choice) {
        case "30d":
            return addDays(now, 30);
        case "90d":
            return addDays(now, 90);
        case "1y":
            return addDays(now, 365);
        case "never":
            return null;
        case "date": {
            if (!picked) return undefined;
            const [y, m, d] = picked.split("-").map(Number);
            if (!y || !m || !d) return undefined;
            return new Date(y, m - 1, d);
        }
    }
}

function formatLongDate(date: Date): string {
    return format(date, "MMM d, yyyy");
}

/**
 * Create an API key, then show it once. The key lives only in this
 * dialog's state and is dropped when the dialog closes, so reopening
 * starts a new key.
 */
export function ApiKeyDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Receives the new key's list entry (never the secret). */
    onCreated: (apiKey: ApiKey) => void;
}) {
    const dateId = useId();
    const [name, setName] = useState("");
    const [choice, setChoice] = useState<ExpiryChoice>("90d");
    const [picked, setPicked] = useState("");
    const [errors, setErrors] = useState<{
        name?: string;
        date?: string;
        form?: string;
    }>({});
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<{
        key: string;
        apiKey: ApiKey;
    } | null>(null);

    const reset = () => {
        setCreated(null);
        setName("");
        setChoice("90d");
        setPicked("");
        setErrors({});
    };

    const now = new Date();
    const expires = expiryDate(choice, picked, now);
    const tomorrow = format(addDays(startOfDay(now), 1), "yyyy-MM-dd");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const found: typeof errors = {};
        if (!name.trim()) {
            found.name = "Name it so you know which key to revoke later";
        }
        if (choice === "date") {
            if (expires === undefined) found.date = "Pick the day it stops";
            else if (expires && expires <= new Date()) {
                found.date = "Pick a day after today";
            }
        }
        if (found.name || found.date) {
            setErrors(found);
            return;
        }
        setCreating(true);
        setErrors({});
        try {
            const response = await fetch("/api/settings/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    expiresAt: expires ? expires.toISOString() : null,
                    scopes: ["read"],
                }),
            });
            if (!response.ok) {
                const body = await parseApiError(response);
                const field = body.details?.field;
                if (field === "name") setErrors({ name: body.error });
                else if (field === "expiresAt") setErrors({ date: body.error });
                else
                    setErrors({
                        form: body.error || "Couldn't create the key",
                    });
                return;
            }
            const data = (await response.json()) as {
                key?: string;
                apiKey?: ApiKey;
            };
            if (!data.key || !data.apiKey) {
                setErrors({ form: "Couldn't create the key" });
                return;
            }
            setCreated({ key: data.key, apiKey: data.apiKey });
            onCreated(data.apiKey);
        } catch {
            setErrors({
                form: "Couldn't reach Riffado. Check your connection, then try again",
            });
        } finally {
            setCreating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={`${settingsDialogClass} sm:max-w-120`}
                onCloseAutoFocus={reset}
            >
                {created ? (
                    <CopyKey
                        apiKeyValue={created.key}
                        apiKey={created.apiKey}
                        onDone={() => onOpenChange(false)}
                    />
                ) : (
                    <form
                        onSubmit={submit}
                        noValidate
                        className="flex flex-col gap-5"
                    >
                        <DialogHeading
                            title="Create an API key"
                            description="For scripts and apps that read your recordings"
                        />
                        <Field
                            label="Name"
                            error={errors.name}
                            hint="So you know which key to revoke later"
                        >
                            <FieldInput
                                autoFocus
                                autoComplete="off"
                                maxLength={120}
                                placeholder="Weekly digest script"
                                value={name}
                                disabled={creating}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    setErrors((c) => ({
                                        ...c,
                                        name: undefined,
                                    }));
                                }}
                                className={dialogInputClass}
                            />
                        </Field>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm leading-5 font-medium text-strong">
                                Expires
                            </p>
                            <ChoiceChips
                                label="Expires"
                                value={choice}
                                onValueChange={(value) => {
                                    setChoice(value);
                                    setErrors((e) => ({
                                        ...e,
                                        date: undefined,
                                    }));
                                }}
                                options={EXPIRY_OPTIONS}
                                aria-describedby={`${dateId}-line`}
                            />
                            {choice === "date" && (
                                <FieldInput
                                    type="date"
                                    aria-label="Stops working on"
                                    min={tomorrow}
                                    value={picked}
                                    disabled={creating}
                                    aria-invalid={
                                        errors.date ? true : undefined
                                    }
                                    onChange={(e) => {
                                        setPicked(e.target.value);
                                        setErrors((c) => ({
                                            ...c,
                                            date: undefined,
                                        }));
                                    }}
                                    className={`${dialogInputClass} w-48`}
                                />
                            )}
                            {errors.date ? (
                                <FieldError id={`${dateId}-line`}>
                                    {errors.date}
                                </FieldError>
                            ) : (
                                <p
                                    id={`${dateId}-line`}
                                    className="text-small text-muted-foreground"
                                >
                                    {expires === null
                                        ? "Works until you revoke it"
                                        : expires
                                          ? `Stops working on ${formatLongDate(expires)}`
                                          : "Pick the day it stops working"}
                                </p>
                            )}
                        </div>
                        <InfoNote title="Read only" icon={Eye}>
                            It can list your recordings and download their
                            audio, transcripts and summaries. It can't change or
                            delete anything.
                        </InfoNote>
                        {errors.form && (
                            <FieldError role="alert">{errors.form}</FieldError>
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                            <Button
                                type="button"
                                variant="bordered"
                                size="dialog"
                                onClick={() => onOpenChange(false)}
                                disabled={creating}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                variant="ink"
                                size="dialog"
                                disabled={creating}
                            >
                                {creating ? "Creating…" : "Create key"}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function CopyKey({
    apiKeyValue,
    apiKey,
    onDone,
}: {
    apiKeyValue: string;
    apiKey: ApiKey;
    onDone: () => void;
}) {
    const until = apiKey.expiresAt
        ? `Until ${formatLongDate(new Date(apiKey.expiresAt))}`
        : "No expiry";
    return (
        <div className="flex flex-col gap-5">
            <DialogHeading
                title="Copy your new key"
                description={`${apiKey.name} · Read only · ${until}`}
            />
            <SecretOnce value={apiKeyValue} copiedMessage="Key copied" />
            <div className="flex flex-col gap-1.5">
                <p className="text-sm leading-5 font-medium text-strong">
                    Send it with each request
                </p>
                <ReadOnlyCode>
                    Authorization: Bearer {apiKeyValue.slice(0, 7)}…
                </ReadOnlyCode>
                <p className="text-small text-muted-foreground">
                    Lost it? Revoke this key and create a new one.
                </p>
            </div>
            <div className="flex justify-end pt-1">
                <Button
                    type="button"
                    variant="bordered"
                    size="dialog"
                    onClick={onDone}
                >
                    Done
                </Button>
            </div>
        </div>
    );
}
