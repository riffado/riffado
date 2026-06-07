"use client";

import { useEffect, useRef, useState } from "react";
import { SearchableModelDropdown } from "@/components/ai/searchable-model-dropdown";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { ProviderPreset } from "@/lib/ai/provider-presets";

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
    discoveredModels?: ModelOption[];
}

export function TranscriptionModelPicker({
    preset,
    apiKey,
    baseUrl,
    value,
    onChange,
    disabled,
    discoveredModels,
}: Props) {
    const [audioModels, setAudioModels] = useState<ModelOption[]>([]);
    const [audioModelsLoading, setAudioModelsLoading] = useState(false);
    const [audioModelsError, setAudioModelsError] = useState<string | null>(
        null,
    );
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
                const data = (await res.json().catch(() => null)) as {
                    models?: ModelOption[];
                    error?: string;
                } | null;
                if (reqId !== requestId.current) return;
                if (!res.ok) {
                    setAudioModels([]);
                    setAudioModelsError(
                        data?.error || "Couldn't load audio models.",
                    );
                    return;
                }
                setAudioModels(data?.models ?? []);
            } catch {
                if (reqId !== requestId.current) return;
                setAudioModelsError("Couldn't load audio models.");
            } finally {
                if (reqId === requestId.current) setAudioModelsLoading(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [shouldFetch, providerName, apiKey, baseUrl]);

    const presetOptions: ModelOption[] = preset?.fetchAudioModels
        ? audioModels
        : (preset?.knownTranscriptionModels ?? []).map((id) => ({
              id,
              name: id,
          }));

    const hasDiscovered = (discoveredModels?.length ?? 0) > 0;
    const hasPresetOptions = presetOptions.length > 0;

    const [useCustom, setUseCustom] = useState(false);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset on preset change
    useEffect(() => {
        setUseCustom(false);
    }, [providerName]);

    useEffect(() => {
        if (!hasPresetOptions && !hasDiscovered) {
            setUseCustom(false);
            return;
        }
        const allOptions =
            hasDiscovered && discoveredModels
                ? discoveredModels
                : presetOptions;
        if (value && !allOptions.some((o) => o.id === value)) {
            setUseCustom(true);
        }
    }, [
        hasPresetOptions,
        hasDiscovered,
        presetOptions,
        discoveredModels,
        value,
    ]);

    const handleSelectChange = (selected: string) => {
        if (selected === CUSTOM_SENTINEL) {
            setUseCustom(true);
            onChange("");
            return;
        }
        setUseCustom(false);
        onChange(selected);
    };

    if (hasDiscovered && !useCustom) {
        return (
            <div className="space-y-2">
                <Label htmlFor="defaultModel">
                    Default Model
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({discoveredModels?.length ?? 0} available)
                    </span>
                </Label>
                <SearchableModelDropdown
                    models={discoveredModels ?? []}
                    value={value}
                    onChange={(v) => {
                        setUseCustom(false);
                        onChange(v);
                    }}
                    disabled={disabled}
                    footer={(close) => (
                        <button
                            type="button"
                            onClick={() => {
                                close();
                                setUseCustom(false);
                                onChange("");
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Type a custom model name instead
                        </button>
                    )}
                />
                {value && (
                    <p className="text-xs text-muted-foreground font-mono truncate">
                        {value}
                    </p>
                )}
            </div>
        );
    }

    let helper: string | null = null;
    if (preset?.fetchAudioModels) {
        if (audioModelsLoading) helper = "Loading audio-capable models…";
        else if (audioModelsError) helper = audioModelsError;
        else if (hasPresetOptions)
            helper = "Only audio-input models are shown.";
        else helper = "Enter your API key to load audio-capable models.";
    } else if (preset?.knownTranscriptionModels?.length) {
        helper =
            "Pick a transcription model. Choose Custom… to type a model id.";
    } else if (!hasDiscovered) {
        helper =
            "Use Test Connection to discover available models, or type a model name.";
    }

    return (
        <div className="space-y-2">
            <Label htmlFor="defaultModel">Default Model</Label>
            {hasPresetOptions && !useCustom ? (
                <Select
                    value={value || undefined}
                    onValueChange={handleSelectChange}
                    disabled={disabled}
                >
                    <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="Pick a transcription model" />
                    </SelectTrigger>
                    <SelectContent>
                        {presetOptions.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                                {m.name}
                            </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_SENTINEL}>
                            Custom (type model name)…
                        </SelectItem>
                    </SelectContent>
                </Select>
            ) : (
                <Input
                    id="defaultModel"
                    type="text"
                    placeholder="whisper-1, gpt-4o, etc."
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="font-mono text-sm"
                />
            )}
            {hasPresetOptions && useCustom && (
                <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => {
                        setUseCustom(false);
                        onChange(presetOptions[0]?.id ?? "");
                    }}
                >
                    Back to suggested models
                </button>
            )}
            {helper && (
                <p className="text-xs text-muted-foreground">{helper}</p>
            )}
        </div>
    );
}
