"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import {
    DialogHeading,
    dialogInputClass,
    monoInputClass,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import {
    AddressRow,
    CUSTOM_PRESET,
    groupPresets,
    presetTile,
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
    getVisiblePresets,
    isLocalPreset,
    type ProviderPreset,
    supportsEnhancement,
} from "@/lib/ai/provider-presets";
import { parseApiError } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface AddProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    /**
     * When true, hide the LM Studio / Ollama presets and say that private
     * addresses aren't reachable from the hosted app. The server also
     * rejects them.
     */
    isHosted?: boolean;
    /** The user's providers, to say which default a new one replaces. */
    providers?: Provider[];
}

interface FormErrors {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    form?: string;
}

/**
 * Add a provider in two steps: pick a service from the preset grid
 * (cloud services, servers you run, or another OpenAI-compatible
 * service), then paste the key, check the address and model, and choose
 * what it's used for.
 */
export function AddProviderDialog({
    open,
    onOpenChange,
    onSuccess,
    isHosted = false,
    providers = [],
}: AddProviderDialogProps) {
    const [presetName, setPresetName] = useState<string | null>(null);
    const [lastPreset, setLastPreset] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [useTranscription, setUseTranscription] = useState(true);
    const [useSummaries, setUseSummaries] = useState(true);
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setPresetName(null);
        setLastPreset(null);
        setErrors({});
    }, [open]);

    const choose = (preset: ProviderPreset) => {
        const mynahIsDefault = providers.some(
            (p) => p.managed === true && p.isDefaultTranscription,
        );
        setPresetName(preset.name);
        setLastPreset(preset.name);
        setApiKey("");
        setBaseUrl(preset.baseUrl);
        setModel(preset.defaultModel);
        setUseTranscription(!mynahIsDefault);
        setUseSummaries(supportsEnhancement(preset.name));
        setErrors({});
    };

    const preset = presetName ? findPreset(presetName) : undefined;
    const isCustom = presetName === CUSTOM_PRESET;
    const isLocal = presetName ? isLocalPreset(presetName) : false;
    const displayName = isCustom ? "service" : (presetName ?? "");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!presetName) return;
        const found: FormErrors = {};
        if (isCustom && !baseUrl.trim()) {
            found.baseUrl = "Enter the service's address";
        }
        if (!apiKey.trim()) {
            found.apiKey = isCustom
                ? "Paste the service's key"
                : `Paste a key from your ${presetName} account`;
        }
        if (found.apiKey || found.baseUrl) {
            setErrors(found);
            return;
        }

        setSaving(true);
        setErrors({});
        try {
            const response = await fetch("/api/settings/ai/providers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: presetName,
                    apiKey: apiKey.trim(),
                    baseUrl: baseUrl.trim() || null,
                    defaultModel: model.trim() || null,
                    isDefaultTranscription: useTranscription,
                    isDefaultEnhancement:
                        useSummaries && supportsEnhancement(presetName),
                }),
            });
            if (!response.ok) {
                const body = await parseApiError(response);
                const field = body.details?.field;
                if (field === "baseUrl") setErrors({ baseUrl: body.error });
                else if (field === "apiKey") setErrors({ apiKey: body.error });
                else setErrors({ form: body.error || "Couldn't add it" });
                return;
            }
            toast.success(isCustom ? "Service added" : `${presetName} added`);
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

    const groups = groupPresets(getVisiblePresets({ isHosted }));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={settingsDialogClass}>
                {presetName === null ? (
                    <>
                        <DialogHeading
                            title="Add a provider"
                            description="Transcribe or write summaries with your own key"
                        />
                        <div className="flex flex-col gap-5">
                            <PresetGroup
                                label="Cloud services"
                                presets={groups.cloud}
                                onChoose={choose}
                                focusName={lastPreset}
                            />
                            {groups.local.length > 0 && (
                                <PresetGroup
                                    label="On your server"
                                    presets={groups.local}
                                    onChoose={choose}
                                    focusName={lastPreset}
                                />
                            )}
                            {groups.custom && (
                                <AnotherServiceTile
                                    onClick={() =>
                                        groups.custom && choose(groups.custom)
                                    }
                                    autoFocus={lastPreset === CUSTOM_PRESET}
                                />
                            )}
                        </div>
                    </>
                ) : (
                    <form
                        onSubmit={submit}
                        noValidate
                        className="flex flex-col gap-5 transition-opacity duration-150 ease-out starting:opacity-0"
                    >
                        <DialogHeading
                            title={
                                isCustom
                                    ? "Add another service"
                                    : `Add ${presetName}`
                            }
                            description={
                                isCustom
                                    ? "Any service with an OpenAI-compatible address"
                                    : isLocal
                                      ? `A model running in ${presetName} on your server`
                                      : `Paste a key from your ${presetName} account`
                            }
                            onBack={() => setPresetName(null)}
                            backLabel="Choose another provider"
                        />

                        {isCustom && (
                            <Field
                                label="Address"
                                error={errors.baseUrl}
                                hint={
                                    isHosted
                                        ? "The hosted app can only reach public addresses"
                                        : undefined
                                }
                            >
                                <FieldInput
                                    type="url"
                                    inputMode="url"
                                    autoComplete="off"
                                    spellCheck={false}
                                    autoFocus
                                    placeholder="http://192.168.1.20:8000/v1"
                                    value={baseUrl}
                                    disabled={saving}
                                    onChange={(e) => {
                                        setBaseUrl(e.target.value);
                                        setErrors((c) => ({
                                            ...c,
                                            baseUrl: undefined,
                                        }));
                                    }}
                                    className={cn(
                                        dialogInputClass,
                                        monoInputClass,
                                    )}
                                />
                            </Field>
                        )}

                        <Field
                            label="API key"
                            error={errors.apiKey}
                            hint={
                                isLocal
                                    ? "Any text works if your server doesn't check keys"
                                    : undefined
                            }
                        >
                            <FieldInput
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                autoFocus={!isCustom}
                                placeholder={preset?.placeholder}
                                value={apiKey}
                                disabled={saving}
                                onChange={(e) => {
                                    setApiKey(e.target.value);
                                    setErrors((c) => ({
                                        ...c,
                                        apiKey: undefined,
                                    }));
                                }}
                                className={cn(dialogInputClass, monoInputClass)}
                            />
                        </Field>

                        {!isCustom && (
                            <AddressRow
                                value={baseUrl}
                                onChange={(value) => {
                                    setBaseUrl(value);
                                    setErrors((c) => ({
                                        ...c,
                                        baseUrl: undefined,
                                    }));
                                }}
                                error={errors.baseUrl}
                                disabled={saving}
                                hint={
                                    isHosted
                                        ? "The hosted app can only reach public addresses"
                                        : undefined
                                }
                            />
                        )}

                        <TranscriptionModelPicker
                            preset={preset}
                            apiKey={apiKey}
                            baseUrl={baseUrl}
                            value={model}
                            onChange={setModel}
                            disabled={saving}
                            error={errors.model}
                        />

                        <UseItForRows
                            providerName={presetName}
                            providers={providers}
                            transcription={useTranscription}
                            summaries={useSummaries}
                            onTranscriptionChange={setUseTranscription}
                            onSummariesChange={setUseSummaries}
                            disabled={saving}
                        />

                        <WhatGetsSentNote
                            providerName={presetName}
                            transcription={useTranscription}
                            summaries={
                                useSummaries && supportsEnhancement(presetName)
                            }
                        />

                        {errors.form && (
                            <FieldError role="alert">{errors.form}</FieldError>
                        )}

                        <div className="flex flex-wrap justify-end gap-2 pt-1">
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
                                {saving ? "Adding…" : `Add ${displayName}`}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function focusOnMount(element: HTMLButtonElement | null) {
    element?.focus();
}

const tileClass =
    "motion-press squircle relative flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border p-3 text-left outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 hover:border-secondary hover:bg-secondary dark:hover:border-night-border dark:hover:bg-night-border";

const markClass =
    "squircle flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-small)] border border-secondary bg-surface font-display text-small leading-4 font-semibold tracking-[0.01em] text-subtle transition-colors group-hover:border-reader group-hover:bg-reader dark:border-night-border dark:bg-night-border dark:group-hover:border-night-raised dark:group-hover:bg-night-raised";

function PresetGroup({
    label,
    presets,
    onChoose,
    focusName,
}: {
    label: string;
    presets: ProviderPreset[];
    onChoose: (preset: ProviderPreset) => void;
    /** Preset to focus when coming back from its form. */
    focusName: string | null;
}) {
    return (
        <section aria-label={label} className="flex flex-col gap-2">
            <h3 className="text-xs leading-4 font-medium text-muted-foreground">
                {label}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
                {presets.map((preset) => {
                    const tile = presetTile(preset.name);
                    return (
                        <button
                            key={preset.name}
                            type="button"
                            onClick={() => onChoose(preset)}
                            ref={
                                focusName === preset.name
                                    ? focusOnMount
                                    : undefined
                            }
                            className={cn(tileClass, "group border-border")}
                        >
                            <span aria-hidden="true" className={markClass}>
                                {tile.mark}
                            </span>
                            <span className="flex min-w-0 flex-col gap-px">
                                <span className="text-ui leading-5 font-medium text-strong">
                                    {preset.name}
                                </span>
                                {tile.description && (
                                    <span className="text-xs leading-4 text-muted-foreground">
                                        {tile.description}
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function AnotherServiceTile({
    onClick,
    autoFocus,
}: {
    onClick: () => void;
    autoFocus: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            ref={autoFocus ? focusOnMount : undefined}
            className={cn(tileClass, "group border-dashed border-border")}
        >
            <span aria-hidden="true" className={markClass}>
                <Plus className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-ui leading-5 font-medium text-strong">
                    Another service
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                    Any OpenAI-compatible address and key
                </span>
            </span>
            <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-subtle"
            />
        </button>
    );
}
