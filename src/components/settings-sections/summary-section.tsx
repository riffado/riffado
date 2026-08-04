"use client";

import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
    type CustomSummaryPrompt,
    SUMMARY_PRESETS,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";

type EditingPrompt = {
    id?: string;
    name: string;
    prompt: string;
};

// Sentinel value used by the auto-summarize preset Select to represent
// "use the user's default prompt". The DB stores this as NULL.
const AUTO_PRESET_DEFAULT = "__default__";

export function SummarySection() {
    const confirm = useConfirm();
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [selectedPrompt, setSelectedPrompt] = useState("general");
    const [customPrompts, setCustomPrompts] = useState<CustomSummaryPrompt[]>(
        [],
    );
    const [outputLanguage, setOutputLanguage] = useState<string>("auto");
    const [editingCustomPrompt, setEditingCustomPrompt] =
        useState<EditingPrompt | null>(null);
    const [viewingPromptId, setViewingPromptId] = useState<string | null>(null);
    const [autoSummarize, setAutoSummarize] = useState(false);
    const [autoSummarizePreset, setAutoSummarizePreset] = useState<
        string | null
    >(null);

    // Per-control AbortController refs so a fast-double-toggle can't let
    // a slow earlier save fail *after* a newer save succeeded and clobber
    // the displayed state with stale `previous` values. Each handler
    // aborts its predecessor and bails out of rollback when its own
    // controller is no longer the latest.
    const promptAbortRef = useRef<AbortController | null>(null);
    const languageAbortRef = useRef<AbortController | null>(null);
    const autoSummarizeAbortRef = useRef<AbortController | null>(null);
    const autoPresetAbortRef = useRef<AbortController | null>(null);

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
                    setCustomPrompts(config?.customPrompts || []);
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

    /**
     * Always echoes the current `customPrompts` back to the server.
     * Sending a partial config here previously wiped custom prompts on
     * every preset change (issue #199) -- `selectedPrompt` and
     * `customPrompts` are one config object and must be saved together.
     */
    const savePromptConfig = async (
        config: SummaryPromptConfiguration,
        signal?: AbortSignal,
    ) => {
        const response = await fetch("/api/settings/user", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summaryPrompt: config }),
            signal,
        });
        if (!response.ok) {
            throw new Error("Failed to save settings");
        }
    };

    const handlePresetChange = async (value: string) => {
        promptAbortRef.current?.abort();
        const ctrl = new AbortController();
        promptAbortRef.current = ctrl;
        const previous = selectedPrompt;
        setSelectedPrompt(value);

        try {
            await savePromptConfig(
                { selectedPrompt: value, customPrompts },
                ctrl.signal,
            );
        } catch {
            // Skip the rollback if a newer click already started a fresh
            // save: the latest click owns the displayed state, and
            // restoring `previous` here would resurrect an outdated value.
            if (promptAbortRef.current !== ctrl) return;
            setSelectedPrompt(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleSaveCustomPrompt = async (prompt: EditingPrompt) => {
        const previousPrompts = customPrompts;
        const isEdit = !!prompt.id;
        const newPrompt: CustomSummaryPrompt = {
            id: prompt.id || nanoid(),
            name: prompt.name,
            prompt: prompt.prompt,
            createdAt: isEdit
                ? customPrompts.find((p) => p.id === prompt.id)?.createdAt ||
                  new Date().toISOString()
                : new Date().toISOString(),
        };

        const updatedPrompts = isEdit
            ? customPrompts.map((p) => (p.id === prompt.id ? newPrompt : p))
            : [...customPrompts, newPrompt];

        setCustomPrompts(updatedPrompts);
        setEditingCustomPrompt(null);

        try {
            await savePromptConfig({
                selectedPrompt,
                customPrompts: updatedPrompts,
            });
            toast.success("Prompt saved");
        } catch {
            // Roll back the optimistic update -- otherwise a later save
            // (e.g. a preset change) would echo this rejected mutation
            // back to the server as if it had succeeded.
            setCustomPrompts(previousPrompts);
            toast.error("Failed to save prompt. Changes reverted.");
        }
    };

    const handleDeleteCustomPrompt = (id: string) => {
        void confirm({
            title: "Delete this custom prompt?",
            description:
                "Recordings already summarized with this prompt keep their existing summaries, but you won't be able to apply it again.",
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: async () => {
                const previousPrompts = customPrompts;
                const previousSelectedPrompt = selectedPrompt;
                const updatedPrompts = customPrompts.filter((p) => p.id !== id);
                const newSelectedPrompt =
                    selectedPrompt === id ? "general" : selectedPrompt;
                setCustomPrompts(updatedPrompts);
                setSelectedPrompt(newSelectedPrompt);
                try {
                    await savePromptConfig({
                        selectedPrompt: newSelectedPrompt,
                        customPrompts: updatedPrompts,
                    });
                } catch {
                    // Roll back both -- same reasoning as the save path above.
                    setCustomPrompts(previousPrompts);
                    setSelectedPrompt(previousSelectedPrompt);
                    toast.error("Failed to delete prompt. Changes reverted.");
                }
            },
        });
    };

    const handleLanguageChange = async (value: string) => {
        languageAbortRef.current?.abort();
        const ctrl = new AbortController();
        languageAbortRef.current = ctrl;
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
                signal: ctrl.signal,
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (languageAbortRef.current !== ctrl) return;
            setOutputLanguage(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleAutoSummarizeChange = async (checked: boolean) => {
        autoSummarizeAbortRef.current?.abort();
        const ctrl = new AbortController();
        autoSummarizeAbortRef.current = ctrl;
        const previous = autoSummarize;
        setAutoSummarize(checked);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoSummarize: checked }),
                signal: ctrl.signal,
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (autoSummarizeAbortRef.current !== ctrl) return;
            setAutoSummarize(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleAutoPresetChange = async (value: string) => {
        autoPresetAbortRef.current?.abort();
        const ctrl = new AbortController();
        autoPresetAbortRef.current = ctrl;
        const previous = autoSummarizePreset;
        const next = value === AUTO_PRESET_DEFAULT ? null : value;
        setAutoSummarizePreset(next);
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoSummarizePreset: next }),
                signal: ctrl.signal,
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (autoPresetAbortRef.current !== ctrl) return;
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

    const viewingCustom = customPrompts.find((p) => p.id === viewingPromptId);
    const viewingPreset =
        viewingPromptId &&
        SUMMARY_PRESETS[viewingPromptId as keyof typeof SUMMARY_PRESETS];
    const viewingText = viewingPreset
        ? viewingPreset.prompt
        : viewingCustom?.prompt || "";
    const viewingName = viewingPreset
        ? viewingPreset.name
        : viewingCustom?.name || "Prompt";
    const viewingDescription = viewingPreset
        ? viewingPreset.description
        : "Custom prompt";
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
                                ]?.name ||
                                    customPrompts.find(
                                        (p) => p.id === selectedPrompt,
                                    )?.name ||
                                    "General Summary"}
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
                            {customPrompts.map((prompt) => (
                                <SelectItem key={prompt.id} value={prompt.id}>
                                    <div>
                                        <div>{prompt.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            Custom prompt
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        The default prompt used when generating summaries. You
                        can override this per-recording.
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

            {/* Custom summary prompts */}
            <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                        Custom Summary Prompts
                    </h3>
                    <Button
                        onClick={() =>
                            setEditingCustomPrompt({ name: "", prompt: "" })
                        }
                        size="sm"
                    >
                        <Plus className="size-4 mr-2" />
                        Add Custom Prompt
                    </Button>
                </div>
                {customPrompts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No custom prompts yet. Create one to get started.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {customPrompts.map((prompt) => (
                            <div
                                key={prompt.id}
                                className="p-4 border rounded-lg"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-medium">
                                                {prompt.name}
                                            </h4>
                                            {selectedPrompt === prompt.id && (
                                                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setViewingPromptId(prompt.id)
                                            }
                                        >
                                            View
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setEditingCustomPrompt({
                                                    id: prompt.id,
                                                    name: prompt.name,
                                                    prompt: prompt.prompt,
                                                })
                                            }
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                handleDeleteCustomPrompt(
                                                    prompt.id,
                                                )
                                            }
                                        >
                                            <Trash2 className="size-4 text-destructive" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* View prompt dialog */}
            {viewingPromptId && (
                <Dialog
                    open={!!viewingPromptId}
                    onOpenChange={(open) => !open && setViewingPromptId(null)}
                >
                    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                        <DialogTitle>{viewingName}</DialogTitle>
                        <DialogDescription>
                            {viewingDescription}
                        </DialogDescription>
                        <div className="mt-4">
                            <pre className="p-4 bg-muted rounded-md text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                                {viewingText}
                            </pre>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Edit/create custom prompt dialog */}
            {editingCustomPrompt && (
                <Dialog
                    open={!!editingCustomPrompt}
                    onOpenChange={(open) =>
                        !open && setEditingCustomPrompt(null)
                    }
                >
                    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                        <DialogTitle>
                            {editingCustomPrompt.id
                                ? "Edit Custom Prompt"
                                : "Create Custom Prompt"}
                        </DialogTitle>
                        <DialogDescription>
                            Create a custom prompt for summary generation. Use{" "}
                            <code className="px-1 py-0.5 bg-muted rounded">
                                {"{transcription}"}
                            </code>{" "}
                            as a placeholder for the transcription text. The
                            model must respond with a JSON object containing{" "}
                            <code className="px-1 py-0.5 bg-muted rounded">
                                summary
                            </code>
                            ,{" "}
                            <code className="px-1 py-0.5 bg-muted rounded">
                                keyPoints
                            </code>
                            , and{" "}
                            <code className="px-1 py-0.5 bg-muted rounded">
                                actionItems
                            </code>{" "}
                            fields.
                        </DialogDescription>
                        <div className="space-y-4 mt-4">
                            <div className="space-y-2">
                                <Label htmlFor="custom-summary-prompt-name">
                                    Name
                                </Label>
                                <Input
                                    id="custom-summary-prompt-name"
                                    value={editingCustomPrompt.name}
                                    onChange={(e) =>
                                        setEditingCustomPrompt((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      name: e.target.value,
                                                  }
                                                : prev,
                                        )
                                    }
                                    placeholder="My Custom Prompt"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="custom-summary-prompt-text">
                                    Prompt
                                </Label>
                                <textarea
                                    id="custom-summary-prompt-text"
                                    className="w-full min-h-[300px] px-3 py-2 text-sm border rounded-md resize-y font-mono"
                                    value={editingCustomPrompt.prompt}
                                    onChange={(e) =>
                                        setEditingCustomPrompt((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      prompt: e.target.value,
                                                  }
                                                : prev,
                                        )
                                    }
                                    placeholder={`Detect the type of recording (meeting, lecture, personal note, interview) and summarize it accordingly.

Respond in the following JSON format (no markdown, no code fences):
{
  "summary": "A concise paragraph summarizing the transcription",
  "keyPoints": ["key point 1", "key point 2"],
  "actionItems": ["action item 1", "action item 2"]
}

If there are no key points or action items, return empty arrays.

Transcription:
{transcription}`}
                                />
                                {editingCustomPrompt.prompt &&
                                    !editingCustomPrompt.prompt.includes(
                                        "{transcription}",
                                    ) && (
                                        <p className="text-xs text-amber-600 dark:text-amber-500">
                                            This prompt doesn&apos;t include{" "}
                                            <code className="px-1 py-0.5 bg-muted rounded">
                                                {"{transcription}"}
                                            </code>{" "}
                                            -- the transcript won&apos;t be
                                            inserted, and the model will only
                                            see this literal text.
                                        </p>
                                    )}
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setEditingCustomPrompt(null)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => {
                                        if (
                                            !editingCustomPrompt.name ||
                                            !editingCustomPrompt.prompt
                                        ) {
                                            toast.error(
                                                "Name and prompt are required",
                                            );
                                            return;
                                        }
                                        handleSaveCustomPrompt(
                                            editingCustomPrompt,
                                        );
                                    }}
                                    disabled={
                                        !editingCustomPrompt.name ||
                                        !editingCustomPrompt.prompt
                                    }
                                >
                                    {editingCustomPrompt.id ? "Save" : "Create"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
