"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

function SearchableModelDropdown({
    models,
    value,
    onChange,
    disabled,
}: {
    models: ModelOption[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        window.addEventListener("mousedown", handleClick);
        return () => window.removeEventListener("mousedown", handleClick);
    }, [open]);

    useEffect(() => {
        if (open) {
            setSearch("");
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const filtered = useMemo(() => {
        if (!search.trim()) return models;
        const q = search.toLowerCase();
        return models.filter((m) => m.name.toLowerCase().includes(q));
    }, [models, search]);

    const selectedLabel = models.find((m) => m.id === value)?.name || value || "Select a model";

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(!open)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            >
                <span className="truncate text-left flex-1">
                    {selectedLabel}
                </span>
                <ChevronDown className="size-4 opacity-50 shrink-0 ml-2" />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
                    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                        <Search className="size-3.5 text-muted-foreground shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${models.length} models...`}
                            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                No models matching &ldquo;{search}&rdquo;
                            </div>
                        ) : (
                            filtered.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(m.id);
                                        setOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-accent hover:text-accent-foreground transition-colors ${
                                        m.id === value ? "bg-accent/50 text-accent-foreground" : ""
                                    }`}
                                >
                                    {m.name}
                                </button>
                            ))
                        )}
                    </div>
                    <div className="border-t border-border/50 px-3 py-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onChange("");
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Type a custom model name instead
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
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
    const [audioModelsError, setAudioModelsError] = useState<string | null>(null);
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
                    setAudioModelsError(data?.error || "Couldn't load audio models.");
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
        : (preset?.knownTranscriptionModels ?? []).map((id) => ({ id, name: id }));

    const hasDiscovered = (discoveredModels?.length ?? 0) > 0;
    const hasPresetOptions = presetOptions.length > 0;

    const [useCustom, setUseCustom] = useState(false);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset on preset change
    useEffect(() => { setUseCustom(false); }, [providerName]);

    useEffect(() => {
        if (!hasPresetOptions && !hasDiscovered) {
            setUseCustom(false);
            return;
        }
        const allOptions = hasDiscovered ? discoveredModels! : presetOptions;
        if (value && !allOptions.some((o) => o.id === value)) {
            setUseCustom(true);
        }
    }, [hasPresetOptions, hasDiscovered, presetOptions, discoveredModels, value]);

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
                        ({discoveredModels!.length} available)
                    </span>
                </Label>
                <SearchableModelDropdown
                    models={discoveredModels!}
                    value={value}
                    onChange={(v) => { setUseCustom(false); onChange(v); }}
                    disabled={disabled}
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
        else if (hasPresetOptions) helper = "Only audio-input models are shown.";
        else helper = "Enter your API key to load audio-capable models.";
    } else if (preset?.knownTranscriptionModels?.length) {
        helper = "Pick a transcription model. Choose Custom… to type a model id.";
    } else if (!hasDiscovered) {
        helper = "Use Test Connection to discover available models, or type a model name.";
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
                    <SelectTrigger>
                        <SelectValue placeholder="Pick a transcription model" />
                    </SelectTrigger>
                    <SelectContent>
                        {presetOptions.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_SENTINEL}>Custom (type model name)…</SelectItem>
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
                    onClick={() => { setUseCustom(false); onChange(presetOptions[0]?.id ?? ""); }}
                >
                    Back to suggested models
                </button>
            )}
            {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
        </div>
    );
}
