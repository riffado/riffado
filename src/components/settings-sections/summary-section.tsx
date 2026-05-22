"use client";

import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import {
    AI_OUTPUT_LANGUAGES,
    SUMMARY_PRESETS,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";

// Sentinel value used by the auto-summarize preset Select to represent
// "use the user's default prompt". The DB stores this as NULL.
const AUTO_PRESET_DEFAULT = "__default__";

export function SummarySection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [selectedPrompt, setSelectedPrompt] = useState("general");
    const [outputLanguage, setOutputLanguage] = useState<string>("auto");
    const [autoSummarize, setAutoSummarize] = useState(false);
    const [autoSummarizePreset, setAutoSummarizePreset] = useState<
        string | null
    >(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    const config =
                        data.summaryPrompt as SummaryPromptConfiguration | null;
                    if (config?.selectedPrompt) {
                        setSelectedPrompt(config.selectedPrompt);
                    }
                    if (typeof data.aiOutputLanguage === "string") {
                        setOutputLanguage(data.aiOutputLanguage);
                    } else {
                        setOutputLanguage("auto");
                    }
                    setAutoSummarize(data.autoSummarize === true);
                    setAutoSummarizePreset(
                        typeof data.autoSummarizePreset === "string"
                            ? data.autoSummarizePreset
                            : null,
                    );
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handlePresetChange = async (value: string) => {
        const previous = selectedPrompt;
        setSelectedPrompt(value);

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    summaryPrompt: {
                        selectedPrompt: value,
                        customPrompts: [],
                    },
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setSelectedPrompt(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleLanguageChange = async (value: string) => {
        const previous = outputLanguage;
        setOutputLanguage(value);

        try {
            // Persist `null` for `auto` so the column reflects "no preference".
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    aiOutputLanguage: value === "auto" ? null : value,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setOutputLanguage(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleAutoSummarizeChange = async (checked: boolean) => {
        const previous = autoSummarize;
        setAutoSummarize(checked);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoSummarize: checked }),
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setAutoSummarize(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleAutoPresetChange = async (value: string) => {
        const previous = autoSummarizePreset;
        const next = value === AUTO_PRESET_DEFAULT ? null : value;
        setAutoSummarizePreset(next);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoSummarizePreset: next }),
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setAutoSummarizePreset(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    const autoPresetValue = autoSummarizePreset ?? AUTO_PRESET_DEFAULT;

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title="Summary"
                description="Prompt presets and provider used when generating recording summaries."
                icon={ListChecks}
            />
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="summary-preset">
                        Default summary prompt
                    </Label>
                    <Select
                        value={selectedPrompt}
                        onValueChange={handlePresetChange}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger id="summary-preset" className="w-full">
                            <SelectValue>
                                {SUMMARY_PRESETS[
                                    selectedPrompt as keyof typeof SUMMARY_PRESETS
                                ]?.name || "General Summary"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {Object.values(SUMMARY_PRESETS).map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                    <div>
                                        <div>{preset.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {preset.description}
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        The default prompt preset used when generating
                        summaries. You can override this per-recording.
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="ai-output-language">
                        AI output language
                    </Label>
                    <Select
                        value={outputLanguage}
                        onValueChange={handleLanguageChange}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger
                            id="ai-output-language"
                            className="w-full"
                        >
                            <SelectValue>
                                {AI_OUTPUT_LANGUAGES.find(
                                    (l) => l.code === outputLanguage,
                                )?.label ?? "Auto (match transcript)"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {AI_OUTPUT_LANGUAGES.map((lang) => (
                                <SelectItem key={lang.code} value={lang.code}>
                                    {lang.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Applies to AI-generated summaries and titles. Auto lets
                        the model match the transcript's language.
                    </p>
                </div>
                <div className="flex items-center justify-between pt-2">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-summarize" className="text-base">
                            Auto-generate summary after transcription
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Triggers after any successful transcription —
                            manual, auto-sync, or re-transcribe. Enable
                            Auto-transcribe to also cover newly synced
                            recordings. Costs one extra AI provider call per
                            generated summary.
                        </p>
                    </div>
                    <Switch
                        id="auto-summarize"
                        checked={autoSummarize}
                        onCheckedChange={handleAutoSummarizeChange}
                        disabled={isSavingSettings}
                    />
                </div>
                {autoSummarize && (
                    <div className="space-y-2">
                        <Label htmlFor="auto-summarize-preset">
                            Preset for auto-summary
                        </Label>
                        <Select
                            value={autoPresetValue}
                            onValueChange={handleAutoPresetChange}
                            disabled={isSavingSettings}
                        >
                            <SelectTrigger
                                id="auto-summarize-preset"
                                className="w-full"
                            >
                                <SelectValue>
                                    {autoPresetValue === AUTO_PRESET_DEFAULT
                                        ? "Use default summary prompt"
                                        : SUMMARY_PRESETS[
                                              autoPresetValue as keyof typeof SUMMARY_PRESETS
                                          ]?.name ||
                                          "Use default summary prompt"}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={AUTO_PRESET_DEFAULT}>
                                    <div>
                                        <div>Use default summary prompt</div>
                                        <div className="text-xs text-muted-foreground">
                                            Inherits the preset selected above
                                        </div>
                                    </div>
                                </SelectItem>
                                {Object.values(SUMMARY_PRESETS).map(
                                    (preset) => (
                                        <SelectItem
                                            key={preset.id}
                                            value={preset.id}
                                        >
                                            <div>
                                                <div>{preset.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {preset.description}
                                                </div>
                                            </div>
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Pick a different preset for the auto-mode (e.g.
                            "Action Items" for meetings) without changing your
                            manual default above.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
