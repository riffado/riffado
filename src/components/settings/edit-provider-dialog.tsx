"use client";

import { Lock, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
    DialogHeading,
    dialogInputClass,
    InfoNote,
    monoInputClass,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import {
    AddressRow,
    providerRemovalCopy,
    summariesProviderId,
    UseItForRows,
    WhatGetsSentNote,
} from "@/components/settings/provider-form";
import { TranscriptionModelPicker } from "@/components/settings/transcription-model-picker";
import type { Provider } from "@/components/settings-sections/providers-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import {
    findPreset,
    isLocalPreset,
    supportsEnhancement,
} from "@/lib/ai/provider-presets";
import { getApiErrorMessage, parseApiError } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type EditableProvider = Pick<
    Provider,
    | "id"
    | "provider"
    | "baseUrl"
    | "defaultModel"
    | "isDefaultTranscription"
    | "isDefaultEnhancement"
>;

interface EditProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider: EditableProvider | null;
    /** Called after a save or a delete, so the parent can re-read the list. */
    onSuccess: () => void;
    /**
     * When true, a saved LM Studio / Ollama provider gets a note that the
     * hosted app can't reach it. The server rejects loopback addresses.
     */
    isHosted?: boolean;
    /** The user's providers, to name defaults and what a delete changes. */
    providers?: Provider[];
}

interface FormErrors {
    apiKey?: string;
    baseUrl?: string;
    form?: string;
}

function roleLine(provider: EditableProvider, providers: Provider[]): string {
    const transcribes = provider.isDefaultTranscription;
    const summarizes = summariesProviderId(providers) === provider.id;
    if (transcribes && summarizes) {
        return "Your provider for transcription and summaries";
    }
    if (transcribes) return "Your provider for transcription";
    if (summarizes) return "Your provider for summaries and titles";
    return "Saved, not your default for anything";
}

/**
 * Edit a saved provider: the key stays hidden ("Saved key, hidden") until
 * replaced, the address and model can change, and the defaults for
 * transcription and summaries are set here. Delete sits on the left and
 * asks first, saying what stops working.
 */
export function EditProviderDialog({
    open,
    onOpenChange,
    provider,
    onSuccess,
    isHosted = false,
    providers = [],
}: EditProviderDialogProps) {
    const confirm = useConfirm();
    const [replacingKey, setReplacingKey] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [useTranscription, setUseTranscription] = useState(false);
    const [useSummaries, setUseSummaries] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    const known: Provider[] =
        providers.length > 0
            ? providers
            : provider
              ? [{ ...provider, createdAt: new Date(0) }]
              : [];

    // biome-ignore lint/correctness/useExhaustiveDependencies: seed once per open, not on every list refresh
    useEffect(() => {
        if (!open || !provider) return;
        setReplacingKey(false);
        setApiKey("");
        setBaseUrl(provider.baseUrl ?? "");
        setModel(provider.defaultModel ?? "");
        setUseTranscription(provider.isDefaultTranscription);
        setUseSummaries(
            supportsEnhancement(provider.provider) &&
                summariesProviderId(known) === provider.id,
        );
        setErrors({});
    }, [open, provider]);

    if (!provider) return null;

    const name = provider.provider;
    const legacyLocal = isHosted && isLocalPreset(name);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (replacingKey && !apiKey.trim()) {
            setErrors({ apiKey: "Paste the new key, or keep the saved one" });
            return;
        }
        setSaving(true);
        setErrors({});
        try {
            const response = await fetch(
                `/api/settings/ai/providers/${provider.id}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        baseUrl: baseUrl.trim() || null,
                        defaultModel: model.trim() || null,
                        isDefaultTranscription: useTranscription,
                        isDefaultEnhancement:
                            useSummaries && supportsEnhancement(name),
                        ...(replacingKey && apiKey.trim()
                            ? { apiKey: apiKey.trim() }
                            : {}),
                    }),
                },
            );
            if (!response.ok) {
                const body = await parseApiError(response);
                if (body.details?.field === "baseUrl") {
                    setErrors({ baseUrl: body.error });
                } else {
                    setErrors({
                        form: body.error || "Couldn't save the changes",
                    });
                }
                return;
            }
            toast.success("Changes saved");
            onSuccess();
            onOpenChange(false);
        } catch {
            setErrors({
                form: "Couldn't reach Riffado. Check your connection, then try again",
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = () => {
        void confirm({
            title: `Delete ${name}?`,
            description: (
                <>
                    <span className="font-medium text-strong">{name}</span> and
                    its saved key are removed from Riffado.{" "}
                    {providerRemovalCopy(
                        { ...provider, createdAt: new Date(0) },
                        known,
                    )}
                </>
            ),
            confirmLabel: "Delete provider",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
                const response = await fetch(
                    `/api/settings/ai/providers/${provider.id}`,
                    { method: "DELETE" },
                );
                if (!response.ok) {
                    throw new Error(
                        await getApiErrorMessage(
                            response,
                            `Couldn't delete ${name}`,
                        ),
                    );
                }
                toast.success(`${name} deleted`);
                onOpenChange(false);
                onSuccess();
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={settingsDialogClass}>
                <form
                    onSubmit={submit}
                    noValidate
                    className="flex flex-col gap-5"
                >
                    <DialogHeading
                        title={name}
                        description={roleLine(provider, known)}
                    />

                    {legacyLocal && (
                        <InfoNote title="The hosted app can't reach it">
                            {name} runs on your own machine. Delete it and add a
                            service with a public address, or self-host Riffado
                        </InfoNote>
                    )}

                    <Field
                        label="API key"
                        error={errors.apiKey}
                        hint={
                            replacingKey
                                ? undefined
                                : "Riffado never shows a saved key. Replace it if you made a new one"
                        }
                    >
                        {replacingKey ? (
                            <div className="flex flex-col gap-1.5">
                                <FieldInput
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus
                                    placeholder={
                                        findPreset(name)?.placeholder ??
                                        "Your new key"
                                    }
                                    value={apiKey}
                                    disabled={saving}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    className={cn(
                                        dialogInputClass,
                                        monoInputClass,
                                    )}
                                />
                                <button
                                    type="button"
                                    className="w-fit text-small text-subtle underline-offset-2 outline-none hover:text-strong hover:underline focus-visible:underline"
                                    onClick={() => {
                                        setReplacingKey(false);
                                        setApiKey("");
                                        setErrors((current) => ({
                                            ...current,
                                            apiKey: undefined,
                                        }));
                                    }}
                                >
                                    Keep the saved key
                                </button>
                            </div>
                        ) : (
                            <div className="squircle flex h-10 items-center gap-2 rounded-[var(--radius-inner)] border border-border bg-surface pr-1 pl-3 dark:bg-night">
                                <Lock
                                    aria-hidden="true"
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                />
                                <span className="min-w-0 flex-1 text-ui text-subtle">
                                    Saved key, hidden
                                </span>
                                <Button
                                    type="button"
                                    variant="quiet"
                                    size="compact"
                                    onClick={() => setReplacingKey(true)}
                                    disabled={saving}
                                >
                                    Replace
                                </Button>
                            </div>
                        )}
                    </Field>

                    <AddressRow
                        value={baseUrl}
                        onChange={(value) => {
                            setBaseUrl(value);
                            setErrors((c) => ({ ...c, baseUrl: undefined }));
                        }}
                        error={errors.baseUrl}
                        disabled={saving}
                    />

                    <TranscriptionModelPicker
                        preset={findPreset(name)}
                        apiKey={apiKey}
                        baseUrl={baseUrl}
                        value={model}
                        onChange={setModel}
                        disabled={saving}
                    />

                    <UseItForRows
                        providerName={name}
                        providers={known}
                        providerId={provider.id}
                        transcription={useTranscription}
                        summaries={useSummaries}
                        onTranscriptionChange={setUseTranscription}
                        onSummariesChange={setUseSummaries}
                        disabled={saving}
                    />

                    <WhatGetsSentNote
                        providerName={name}
                        transcription={useTranscription}
                        summaries={useSummaries && supportsEnhancement(name)}
                    />

                    {errors.form && (
                        <FieldError role="alert">{errors.form}</FieldError>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="dialog"
                            className="-ml-3 px-3"
                            onClick={remove}
                            disabled={saving}
                        >
                            <Trash2 />
                            Delete provider
                        </Button>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="bordered"
                                size="dialog"
                                onClick={() => onOpenChange(false)}
                                disabled={saving}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                variant="ink"
                                size="dialog"
                                disabled={saving}
                            >
                                {saving ? "Saving…" : "Save changes"}
                            </Button>
                        </div>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
