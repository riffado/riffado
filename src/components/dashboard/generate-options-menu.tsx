"use client";

import {
    Languages,
    Loader2,
    MessageSquareText,
    Mic,
    Sparkles,
    Users,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
    nickname: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
}

interface GenerateOptionsMenuProps {
    open: boolean;
    onClose: () => void;
    onGenerate: (config: GenerateConfig) => void;
    onAutoGenerate: () => void;
    isGenerating: boolean;
}

export function GenerateOptionsMenu({
    open,
    onClose,
    onGenerate,
    onAutoGenerate,
    isGenerating,
}: GenerateOptionsMenuProps) {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [isLoadingProviders, setIsLoadingProviders] = useState(true);

    // Config state
    const [transcriptionProviderId, setTranscriptionProviderId] =
        useState<string>("default");
    const [summaryProviderId, setSummaryProviderId] =
        useState<string>("default");
    const [summaryPreset, setSummaryPreset] = useState("general");
    const [language, setLanguage] = useState("auto");
    const [autoSpeakerLabeling, setAutoSpeakerLabeling] = useState(false);

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

    const _transcriptionProviders = providers.filter(
        (p) => p.isDefaultTranscription || p.provider === "Custom",
    );
    const _summaryProviders = providers.filter(
        (p) => p.isDefaultEnhancement || p.provider === "Custom",
    );

    const handleGenerate = useCallback(() => {
        onGenerate({
            transcriptionProviderId:
                transcriptionProviderId === "default"
                    ? null
                    : transcriptionProviderId,
            transcriptionModel: null,
            summaryProviderId:
                summaryProviderId === "default" ? null : summaryProviderId,
            summaryModel: null,
            summaryPreset,
            language,
            autoSpeakerLabeling,
        });
    }, [
        transcriptionProviderId,
        summaryProviderId,
        summaryPreset,
        language,
        autoSpeakerLabeling,
        onGenerate,
    ]);

    if (!open) return null;

    return (
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <div className="rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-muted/30">
                    <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <span className="text-sm font-semibold">
                            Generate Options
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Close
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {isLoadingProviders ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading providers…
                        </div>
                    ) : (
                        <>
                            {/* Transcription model */}
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Mic className="size-3" />
                                    Transcription Provider
                                </Label>
                                <Select
                                    value={transcriptionProviderId}
                                    onValueChange={setTranscriptionProviderId}
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
                                                {p.nickname || p.provider}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Summary model */}
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <MessageSquareText className="size-3" />
                                    Summary Provider
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
                                                {p.nickname || p.provider}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Summary template */}
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

                            {/* Language */}
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

                            {/* Speaker labeling */}
                            <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
                                <Label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                    <Users className="size-3 text-muted-foreground" />
                                    Auto Speaker Labeling
                                </Label>
                                <Switch
                                    checked={autoSpeakerLabeling}
                                    onCheckedChange={setAutoSpeakerLabeling}
                                />
                            </div>
                        </>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                        <Button
                            onClick={onAutoGenerate}
                            variant="outline"
                            disabled={isGenerating || isLoadingProviders}
                            className="flex-1 h-9 gap-1.5 text-xs"
                        >
                            <Zap className="size-3.5" />
                            Auto Generate
                        </Button>
                        <Button
                            onClick={handleGenerate}
                            disabled={isGenerating || isLoadingProviders}
                            className="flex-1 h-9 gap-1.5 text-xs bg-primary hover:bg-primary/90"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="size-3.5 animate-spin" />
                                    Running…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="size-3.5" />
                                    Generate
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
