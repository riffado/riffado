"use client";

/**
 * Model picker shared by the Add/Edit provider dialogs.
 *
 * Three modes:
 *   - Preset has `fetchAudioModels: true` (OpenRouter): live-fetch the
 *     audio-input model list from the provider's /v1/models endpoint via
 *     `POST /api/settings/ai/providers/models`. Debounced on apiKey change.
 *   - Preset has `knownTranscriptionModels`: render a dropdown from the
 *     hand-curated list shipped in `provider-presets.ts`.
 *   - Otherwise: plain freeform text input (LM Studio / Ollama / Custom).
 *
 * Both list modes include a final "Type a model name" option as an escape
 * hatch so users on a stale Riffado release can still type a model id we
 * haven't seeded yet.
 */

import { useEffect, useId, useRef, useState } from "react";
import {
    dialogInputClass,
    monoInputClass,
} from "@/components/settings/form-controls";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import { Field, FieldInput } from "@/components/ui/field";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import type { ProviderPreset } from "@/lib/ai/provider-presets";
import { getApiErrorMessage } from "@/lib/api-errors";

interface ModelOption {
    id: string;
    name: string;
}

const CUSTOM_SENTINEL = "__custom__";

interface Props {
    preset: ProviderPreset | undefined;
    apiKey: string;
    baseUrl: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    /** An error from saving that belongs to the model. */
    error?: string | null;
}

export function TranscriptionModelPicker({
    preset,
    apiKey,
    baseUrl,
    value,
    onChange,
    disabled,
    error,
}: Props) {
    const fieldId = useId();
    // Live fetch for `fetchAudioModels: true` presets.
    const [audioModels, setAudioModels] = useState<ModelOption[]>([]);
    const [audioModelsLoading, setAudioModelsLoading] = useState(false);
    const [audioModelsError, setAudioModelsError] = useState<string | null>(
        null,
    );
    // Used to discard out-of-order audio-model fetches when the user
    // toggles providers / edits the key faster than the network responds.
    const requestId = useRef(0);

    const shouldFetch =
        preset?.fetchAudioModels === true && apiKey.trim().length > 0;
    const providerName = preset?.name ?? "";

    useEffect(() => {
        if (!shouldFetch) {
            setAudioModels([]);
            setAudioModelsError(null);
            setAudioModelsLoading(false);
            return;
        }
        // Debounce so we don't fire a request on every keystroke of the
        // API key paste. 400ms feels responsive without being chatty.
        const reqId = ++requestId.current;
        setAudioModelsLoading(true);
        setAudioModelsError(null);
        const timer = setTimeout(async () => {
            try {
                const res = await fetch("/api/settings/ai/providers/models", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider: providerName,
                        apiKey,
                        baseUrl: baseUrl || null,
                    }),
                });
                if (reqId !== requestId.current) return;
                if (!res.ok) {
                    setAudioModels([]);
                    setAudioModelsError(
                        await getApiErrorMessage(
                            res,
                            "Couldn't load the models. Check the key, then try again",
                        ),
                    );
                    return;
                }
                const data = (await res.json().catch(() => null)) as {
                    models?: ModelOption[];
                } | null;
                if (reqId !== requestId.current) return;
                setAudioModels(data?.models ?? []);
            } catch {
                if (reqId !== requestId.current) return;
                setAudioModelsError(
                    `Couldn't reach ${providerName || "the provider"}. Check your connection, then try again`,
                );
            } finally {
                if (reqId === requestId.current) {
                    setAudioModelsLoading(false);
                }
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [shouldFetch, providerName, apiKey, baseUrl]);

    // Resolve which option list (if any) we should render.
    const options: ModelOption[] = preset?.fetchAudioModels
        ? audioModels
        : (preset?.knownTranscriptionModels ?? []).map((id) => ({
              id,
              name: id,
          }));

    const hasOptions = options.length > 0;

    // Custom-mode toggle: true when the user explicitly picked "Type a
    // model name" OR when the stored `value` isn't one of the curated
    // options (legacy values or hand-typed ids from a stale release).
    const [useCustom, setUseCustom] = useState(false);

    // Reset whenever the selected preset changes. Without this, picking
    // "Type a model name" on one provider and then switching providers
    // leaves the picker stuck in freeform mode for the new provider.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset on preset change only.
    useEffect(() => {
        setUseCustom(false);
    }, [providerName]);

    useEffect(() => {
        if (!hasOptions) {
            setUseCustom(false);
            return;
        }
        if (value && !options.some((o) => o.id === value)) {
            setUseCustom(true);
        }
        // We deliberately don't flip useCustom back to false when value
        // matches an option — the user might be in the middle of typing.
    }, [hasOptions, options, value]);

    const handleSelectChange = (selected: string) => {
        if (selected === CUSTOM_SENTINEL) {
            setUseCustom(true);
            onChange("");
            return;
        }
        setUseCustom(false);
        onChange(selected);
    };

    let hint: string | undefined;
    if (preset?.fetchAudioModels) {
        if (audioModelsLoading) {
            hint = "Loading the models that take audio…";
        } else if (hasOptions) {
            hint =
                "Only models that take audio are listed. They transcribe mp3 and wav recordings";
        } else {
            hint = "Paste your key to see the models that take audio";
        }
    }

    const fieldError = error || audioModelsError || undefined;

    return (
        <Field label="Model" id={fieldId} error={fieldError} hint={hint}>
            {hasOptions && !useCustom ? (
                <Select
                    value={value || undefined}
                    onValueChange={handleSelectChange}
                    disabled={disabled}
                >
                    <SettingsSelectTrigger
                        id={fieldId}
                        aria-describedby={
                            fieldError || hint
                                ? `${fieldId}-message`
                                : undefined
                        }
                        aria-invalid={fieldError ? true : undefined}
                        className="h-10 w-full rounded-[var(--radius-inner)] border-input font-mono text-small font-normal data-[size=default]:h-10"
                    >
                        <SelectValue placeholder="Pick a model" />
                    </SettingsSelectTrigger>
                    <SelectContent>
                        {options.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                                {m.name}
                            </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_SENTINEL}>
                            Type a model name…
                        </SelectItem>
                    </SelectContent>
                </Select>
            ) : (
                <div className="flex flex-col gap-1.5">
                    <FieldInput
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                            preset?.defaultModel ||
                            "whisper-large-v3, qwen2.5:14b"
                        }
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        disabled={disabled}
                        className={`${dialogInputClass} ${monoInputClass}`}
                    />
                    {hasOptions && (
                        <button
                            type="button"
                            className="w-fit text-small text-subtle underline-offset-2 outline-none hover:text-strong hover:underline focus-visible:underline"
                            onClick={() => {
                                setUseCustom(false);
                                onChange(options[0]?.id ?? "");
                            }}
                        >
                            Pick from the list instead
                        </button>
                    )}
                </div>
            )}
        </Field>
    );
}
