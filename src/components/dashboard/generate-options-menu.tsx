"use client";

import {
    CheckCircle2,
    Languages,
    Loader2,
    MessageSquareText,
    Mic,
    Plug,
    Sparkles,
    Users,
    XCircle,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchableModelDropdown } from "@/components/ai/searchable-model-dropdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AI_OUTPUT_LANGUAGES, SUMMARY_PRESETS } from "@/lib/ai/summary-presets";

export interface GenerateConfig {
    transcriptionProviderId: string | null;
    transcriptionModel: string | null;
    summaryProviderId: string | null;
    summaryModel: string | null;
    summaryPreset: string;
    language: string;
    autoSpeakerLabeling: boolean;
}

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    nickname: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
}

interface ModelOption {
    id: string;
    name: string;
}

/**
 * Which passes the menu controls:
 *   - "full":          first-time generation — transcription + summary.
 *   - "transcription": re-generate the transcript only.
 *   - "summary":       re-generate the summary only.
 */
type GenerateMode = "full" | "transcription" | "summary";

interface GenerateOptionsMenuProps {
    open: boolean;
    onClose: () => void;
    onGenerate: (config: GenerateConfig) => void;
    onAutoGenerate: () => void;
    isGenerating: boolean;
    /** Defaults to "full" (first-time generation). */
    mode?: GenerateMode;
    /** Seed the summary template select (e.g. from the panel's current preset). */
    initialSummaryPreset?: string;
    /** Seed the output-language select. */
    initialLanguage?: string;
}

/**
 * Per-provider model controls: a model dropdown plus a "Test Connection"
 * button that probes the saved provider (using its stored, encrypted key
 * server-side) and populates the dropdown with the models that server
 * actually exposes — mirroring the Test Connection flow in Settings.
 *
 * When the provider is left on "Default (from Settings)" we can't know
 * which server to probe, so we show a hint instead of an empty dropdown.
 */
function ProviderModelControls({
    providers,
    providerId,
    model,
    onModelChange,
}: {
    providers: Provider[];
    providerId: string;
    model: string;
    onModelChange: (model: string) => void;
}) {
    const [discovered, setDiscovered] = useState<ModelOption[]>([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);

    const selected = providers.find((p) => p.id === providerId) ?? null;

    // When the chosen provider changes, drop any discovered models / result
    // from the previous provider so the dropdown can't show stale options.
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on provider id
    useEffect(() => {
        setDiscovered([]);
        setTestResult(null);
    }, [providerId]);

    const modelOptions = useMemo(() => {
        const opts: ModelOption[] = [];
        if (selected?.defaultModel) {
            opts.push({
                id: selected.defaultModel,
                name: `${selected.defaultModel} · provider default`,
            });
        }
        for (const m of discovered) {
            if (m.id !== selected?.defaultModel) opts.push(m);
        }
        return opts;
    }, [selected, discovered]);

    const handleTest = useCallback(async () => {
        if (!selected) return;
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(
                "/api/settings/ai/providers/test-connection",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider: selected.provider,
                        // No apiKey field → the server decrypts the stored
                        // key for this providerId. Same path Settings uses.
                        providerId: selected.id,
                        baseUrl: selected.baseUrl || null,
                    }),
                },
            );
            const data = (await res.json().catch(() => null)) as {
                ok?: boolean;
                message?: string;
                models?: ModelOption[];
            } | null;
            setTestResult({
                ok: !!data?.ok,
                message: data?.message ?? "No response from server.",
            });
            if (data?.ok && Array.isArray(data.models)) {
                setDiscovered(data.models);
            }
        } catch {
            setTestResult({
                ok: false,
                message: "Failed to reach the test endpoint.",
            });
        } finally {
            setTesting(false);
        }
    }, [selected]);

    // "Default (from Settings)" — no concrete server to pick a model from.
    if (!selected) {
        return (
            <p className="pl-0.5 text-[11px] text-muted-foreground">
                Uses the default model from your provider settings.
            </p>
        );
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <SearchableModelDropdown
                        models={modelOptions}
                        value={model}
                        onChange={onModelChange}
                        emptyOption={{ value: "", label: "Provider default" }}
                        allowCustomText
                        placeholder="Provider default"
                        triggerClassName="h-8 text-xs"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                >
                    {testing ? (
                        <Loader2 className="size-3 animate-spin" />
                    ) : (
                        <Plug className="size-3" />
                    )}
                    {testing ? "Testing…" : "Test"}
                </button>
            </div>
            {testResult && (
                <div
                    className={`flex items-start gap-1.5 rounded-md border p-2 text-[11px] ${
                        testResult.ok
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                    }`}
                >
                    {testResult.ok ? (
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                    ) : (
                        <XCircle className="mt-0.5 size-3 shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                </div>
            )}
        </div>
    );
}

export function GenerateOptionsMenu({
    open,
    onClose,
    onGenerate,
    onAutoGenerate,
    isGenerating,
    mode = "full",
    initialSummaryPreset = "general",
    initialLanguage = "auto",
}: GenerateOptionsMenuProps) {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [isLoadingProviders, setIsLoadingProviders] = useState(true);

    // Config state
    const [transcriptionProviderId, setTranscriptionProviderId] =
        useState<string>("default");
    const [transcriptionModel, setTranscriptionModel] = useState<string>("");
    const [summaryProviderId, setSummaryProviderId] =
        useState<string>("default");
    const [summaryModel, setSummaryModel] = useState<string>("");
    const [summaryPreset, setSummaryPreset] = useState(initialSummaryPreset);
    const [language, setLanguage] = useState(initialLanguage);
    const [autoSpeakerLabeling, setAutoSpeakerLabeling] = useState(false);

    const showTranscription = mode === "full" || mode === "transcription";
    const showSummary = mode === "full" || mode === "summary";

    // Load providers
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setIsLoadingProviders(true);
        fetch("/api/settings/ai/providers")
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                setProviders(data.providers ?? []);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setIsLoadingProviders(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    // Reset the dependent model when its provider changes — a model id from
    // provider A is meaningless for provider B.
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on provider id
    useEffect(() => {
        setTranscriptionModel("");
    }, [transcriptionProviderId]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on provider id
    useEffect(() => {
        setSummaryModel("");
    }, [summaryProviderId]);

    const handleGenerate = useCallback(() => {
        onGenerate({
            transcriptionProviderId:
                transcriptionProviderId === "default"
                    ? null
                    : transcriptionProviderId,
            transcriptionModel: transcriptionModel || null,
            summaryProviderId:
                summaryProviderId === "default" ? null : summaryProviderId,
            summaryModel: summaryModel || null,
            summaryPreset,
            language,
            autoSpeakerLabeling,
        });
    }, [
        transcriptionProviderId,
        transcriptionModel,
        summaryProviderId,
        summaryModel,
        summaryPreset,
        language,
        autoSpeakerLabeling,
        onGenerate,
    ]);

    if (!open) return null;

    const title =
        mode === "transcription"
            ? "Re-generate Transcription"
            : mode === "summary"
              ? "Re-generate Summary"
              : "Generate Options";
    const generateLabel = mode === "full" ? "Generate" : "Re-generate";
    const autoLabel = mode === "full" ? "Auto Generate" : "Use Defaults";

    return (
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/95 shadow-xl backdrop-blur-sm">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-5 py-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <span className="text-sm font-semibold">{title}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Close
                    </button>
                </div>

                <div className="space-y-4 p-5">
                    {isLoadingProviders ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading providers…
                        </div>
                    ) : (
                        <>
                            {/* ── Transcription pass ─────────────────── */}
                            {showTranscription && (
                                <div className="space-y-2.5 rounded-lg border border-border/40 p-3">
                                    <div className="space-y-1.5">
                                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Mic className="size-3" />
                                            Transcription Server
                                        </Label>
                                        <Select
                                            value={transcriptionProviderId}
                                            onValueChange={
                                                setTranscriptionProviderId
                                            }
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem
                                                    value="default"
                                                    className="text-xs"
                                                >
                                                    Default (from Settings)
                                                </SelectItem>
                                                {providers.map((p) => (
                                                    <SelectItem
                                                        key={p.id}
                                                        value={p.id}
                                                        className="text-xs"
                                                    >
                                                        {p.nickname ||
                                                            p.provider}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground/80">
                                            Model
                                        </Label>
                                        <ProviderModelControls
                                            providers={providers}
                                            providerId={transcriptionProviderId}
                                            model={transcriptionModel}
                                            onModelChange={
                                                setTranscriptionModel
                                            }
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ── Summary pass ───────────────────────── */}
                            {showSummary && (
                                <div className="space-y-2.5 rounded-lg border border-border/40 p-3">
                                    <div className="space-y-1.5">
                                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <MessageSquareText className="size-3" />
                                            Summary Server
                                        </Label>
                                        <Select
                                            value={summaryProviderId}
                                            onValueChange={setSummaryProviderId}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem
                                                    value="default"
                                                    className="text-xs"
                                                >
                                                    Default (from Settings)
                                                </SelectItem>
                                                {providers.map((p) => (
                                                    <SelectItem
                                                        key={p.id}
                                                        value={p.id}
                                                        className="text-xs"
                                                    >
                                                        {p.nickname ||
                                                            p.provider}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] text-muted-foreground/80">
                                            Model
                                        </Label>
                                        <ProviderModelControls
                                            providers={providers}
                                            providerId={summaryProviderId}
                                            model={summaryModel}
                                            onModelChange={setSummaryModel}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ── Summary template ───────────────────── */}
                            {showSummary && (
                                <div className="space-y-1.5">
                                    <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Sparkles className="size-3" />
                                        Summary Template
                                    </Label>
                                    <Select
                                        value={summaryPreset}
                                        onValueChange={setSummaryPreset}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.values(SUMMARY_PRESETS).map(
                                                (preset) => (
                                                    <SelectItem
                                                        key={preset.id}
                                                        value={preset.id}
                                                        className="text-xs"
                                                    >
                                                        {preset.name}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* ── Output language ────────────────────── */}
                            {showSummary && (
                                <div className="space-y-1.5">
                                    <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Languages className="size-3" />
                                        Output Language
                                    </Label>
                                    <Select
                                        value={language}
                                        onValueChange={setLanguage}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {AI_OUTPUT_LANGUAGES.map((lang) => (
                                                <SelectItem
                                                    key={lang.code}
                                                    value={lang.code}
                                                    className="text-xs"
                                                >
                                                    {lang.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* ── Speaker labeling (full only) ───────── */}
                            {mode === "full" && (
                                <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
                                    <Label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                        <Users className="size-3 text-muted-foreground" />
                                        Auto Speaker Labeling
                                    </Label>
                                    <Switch
                                        checked={autoSpeakerLabeling}
                                        onCheckedChange={setAutoSpeakerLabeling}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                        <Button
                            onClick={onAutoGenerate}
                            variant="outline"
                            disabled={isGenerating || isLoadingProviders}
                            className="h-9 flex-1 gap-1.5 text-xs"
                        >
                            <Zap className="size-3.5" />
                            {autoLabel}
                        </Button>
                        <Button
                            onClick={handleGenerate}
                            disabled={isGenerating || isLoadingProviders}
                            className="h-9 flex-1 gap-1.5 bg-primary text-xs hover:bg-primary/90"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="size-3.5 animate-spin" />
                                    Running…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="size-3.5" />
                                    {generateLabel}
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
