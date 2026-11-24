"use client";

import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { summaryProviderStateFor } from "@/components/recording/summary-provider";
import { PromptList } from "@/components/settings/prompt-list";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
    ToggleRow,
} from "@/components/settings/toggle-row";
import type { Provider } from "@/components/settings-sections/providers-section";
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
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import {
    AI_OUTPUT_LANGUAGES,
    type CustomSummaryPrompt,
    SUMMARY_PRESETS,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { toast } from "@/lib/toast";

type EditingPrompt = {
    id?: string;
    name: string;
    prompt: string;
};

// Sentinel value used by the auto-summarize preset Select to represent
// "use the user's default prompt". The DB stores this as NULL.
const AUTO_PRESET_DEFAULT = "__default__";

/**
 * Summary defaults and the user's summary prompts. Automatic summaries
 * are hidden until a provider that can write summaries exists.
 */
export function SummarySection({
    providers,
}: {
    /** The shared provider list; null while loading (treated as ready). */
    providers: Provider[] | null;
}) {
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
    const canSummarize = summaryProviderStateFor(providers) !== "missing";

    return (
        <SettingsGroup
            title="Summaries"
            description="How summaries are written, and when"
        >
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={3} />
            ) : (
                <SettingsRows>
                    <SettingsRow
                        label="Summary style"
                        description="Your default. You can pick another for each recording"
                        controlId="summary-preset"
                        control={
                            <Select
                                value={selectedPrompt}
                                onValueChange={handlePresetChange}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="summary-preset">
                                    <SelectValue>
                                        {SUMMARY_PRESETS[
                                            selectedPrompt as keyof typeof SUMMARY_PRESETS
                                        ]?.name ||
                                            customPrompts.find(
                                                (p) => p.id === selectedPrompt,
                                            )?.name ||
                                            "General Summary"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
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
                                    {customPrompts.map((prompt) => (
                                        <SelectItem
                                            key={prompt.id}
                                            value={prompt.id}
                                        >
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
                        }
                    />
                    <SettingsRow
                        label="Output language"
                        description="For summaries and titles. Auto matches the transcript"
                        controlId="ai-output-language"
                        control={
                            <Select
                                value={outputLanguage}
                                onValueChange={handleLanguageChange}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="ai-output-language">
                                    <SelectValue>
                                        {AI_OUTPUT_LANGUAGES.find(
                                            (l) => l.code === outputLanguage,
                                        )?.label ?? "Auto (match transcript)"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {AI_OUTPUT_LANGUAGES.map((lang) => (
                                        <SelectItem
                                            key={lang.code}
                                            value={lang.code}
                                        >
                                            {lang.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                    {canSummarize ? (
                        <ToggleRow
                            id="auto-summarize"
                            label="Summarize after transcription"
                            description="Runs after every transcription, including re-transcribing. Each summary is one more call to your provider"
                            checked={autoSummarize}
                            onCheckedChange={handleAutoSummarizeChange}
                            disabled={isSavingSettings}
                        />
                    ) : null}
                    {canSummarize && autoSummarize && (
                        <SettingsRow
                            label="Style for automatic summaries"
                            description="Lets them differ from your default, e.g. Action Items for meetings"
                            controlId="auto-summarize-preset"
                            control={
                                <Select
                                    value={autoPresetValue}
                                    onValueChange={handleAutoPresetChange}
                                    disabled={isSavingSettings}
                                >
                                    <SettingsSelectTrigger id="auto-summarize-preset">
                                        <SelectValue>
                                            {autoPresetValue ===
                                            AUTO_PRESET_DEFAULT
                                                ? "Same as default"
                                                : SUMMARY_PRESETS[
                                                      autoPresetValue as keyof typeof SUMMARY_PRESETS
                                                  ]?.name || "Same as default"}
                                        </SelectValue>
                                    </SettingsSelectTrigger>
                                    <SelectContent align="end">
                                        <SelectItem value={AUTO_PRESET_DEFAULT}>
                                            <div>
                                                <div>Same as default</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Uses the summary style above
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
                            }
                        />
                    )}
                </SettingsRows>
            )}
            {canSummarize ? null : (
                <p className="text-ui text-subtle">
                    Automatic summaries appear once you{" "}
                    <a
                        href="#providers"
                        className="font-medium text-strong underline-offset-4 hover:underline"
                    >
                        add a provider
                    </a>
                </p>
            )}

            <PromptList
                title="Your summary prompts"
                emptyText="None yet. Write one when the built-in styles don't fit"
                addLabel="New prompt"
                onAdd={() => setEditingCustomPrompt({ name: "", prompt: "" })}
                items={customPrompts.map((prompt) => ({
                    id: prompt.id,
                    name: prompt.name,
                    active: selectedPrompt === prompt.id,
                }))}
                onView={setViewingPromptId}
                onEdit={(id) => {
                    const prompt = customPrompts.find((p) => p.id === id);
                    if (prompt) {
                        setEditingCustomPrompt({
                            id: prompt.id,
                            name: prompt.name,
                            prompt: prompt.prompt,
                        });
                    }
                }}
                onDelete={handleDeleteCustomPrompt}
            />

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
        </SettingsGroup>
    );
}
