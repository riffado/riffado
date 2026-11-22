"use client";

import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { PromptList } from "@/components/settings/prompt-list";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
} from "@/components/settings/toggle-row";
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
import { PROMPT_PRESETS } from "@/lib/ai/prompt-presets";
import { toast } from "@/lib/toast";

interface CustomPrompt {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
}

type EditingPrompt = {
    id?: string;
    name: string;
    prompt: string;
};

/**
 * Title-generation prompt management. Owns:
 *  - Active prompt selector (chooses among presets + user customs).
 *  - Preset prompt list (read-only view of the shipped PROMPT_PRESETS).
 *  - Custom prompt CRUD with confirm-delete.
 *  - View dialog (read the full prompt text) and edit dialog
 *    (create / edit a custom prompt).
 *
 * Hoisted out of ProvidersSection because the AI providers list and
 * the prompt manager only share a tab bar; their data, dialogs, and
 * persistence calls are otherwise independent. Keeping them in one
 * 710-line component meant useState calls + effects + dialogs
 * cross-pollinating that didn't need to.
 *
 * Persists via PUT /api/settings/user, `titleGenerationPrompt` field.
 */
export function PromptManager() {
    const confirm = useConfirm();
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [selectedPromptId, setSelectedPromptId] = useState<string>("default");
    const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>([]);
    const [editingCustomPrompt, setEditingCustomPrompt] =
        useState<EditingPrompt | null>(null);
    const [viewingPromptId, setViewingPromptId] = useState<string | null>(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    if (data.titleGenerationPrompt) {
                        const promptConfig = data.titleGenerationPrompt as {
                            selectedPrompt?: string;
                            customPrompts?: CustomPrompt[];
                        };
                        setSelectedPromptId(
                            promptConfig.selectedPrompt || "default",
                        );
                        setCustomPrompts(promptConfig.customPrompts || []);
                    } else {
                        setSelectedPromptId("default");
                        setCustomPrompts([]);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handlePromptSettingChange = async (config: {
        selectedPrompt: string;
        customPrompts: CustomPrompt[];
    }) => {
        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ titleGenerationPrompt: config }),
            });
            if (!response.ok) {
                throw new Error("Failed to save prompt settings");
            }
            toast.success("Prompt settings saved");
        } catch {
            toast.error("Failed to save prompt settings");
        }
    };

    const handleSaveCustomPrompt = async (prompt: EditingPrompt) => {
        const isEdit = !!prompt.id;
        const newPrompt: CustomPrompt = {
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

        await handlePromptSettingChange({
            selectedPrompt: selectedPromptId,
            customPrompts: updatedPrompts,
        });
    };

    const handleDeleteCustomPrompt = (id: string) => {
        void confirm({
            title: "Delete this custom prompt?",
            description:
                "Recordings already summarized with this prompt keep their existing summaries, but you won't be able to apply it again.",
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: async () => {
                const updatedPrompts = customPrompts.filter((p) => p.id !== id);
                setCustomPrompts(updatedPrompts);
                const newSelectedPrompt =
                    selectedPromptId === id ? "default" : selectedPromptId;
                setSelectedPromptId(newSelectedPrompt);
                await handlePromptSettingChange({
                    selectedPrompt: newSelectedPrompt,
                    customPrompts: updatedPrompts,
                });
            },
        });
    };

    const viewingText =
        viewingPromptId &&
        (PROMPT_PRESETS[viewingPromptId as keyof typeof PROMPT_PRESETS]
            ?.prompt ||
            customPrompts.find((p) => p.id === viewingPromptId)?.prompt ||
            "");

    const viewingName =
        viewingPromptId &&
        (PROMPT_PRESETS[viewingPromptId as keyof typeof PROMPT_PRESETS]?.name ||
            customPrompts.find((p) => p.id === viewingPromptId)?.name ||
            "Prompt");

    const viewingDescription =
        viewingPromptId &&
        (PROMPT_PRESETS[viewingPromptId as keyof typeof PROMPT_PRESETS]
            ?.description ||
            "Custom prompt");

    return (
        <SettingsGroup
            title="Titles"
            description="The prompt used to name recordings"
        >
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={1} />
            ) : (
                <SettingsRows>
                    <SettingsRow
                        label="Title prompt"
                        description="Used when Riffado names a recording"
                        controlId="selected-prompt"
                        control={
                            <Select
                                value={selectedPromptId}
                                onValueChange={(value) => {
                                    setSelectedPromptId(value);
                                    handlePromptSettingChange({
                                        selectedPrompt: value,
                                        customPrompts,
                                    });
                                }}
                                disabled={isSavingSettings}
                            >
                                <SettingsSelectTrigger id="selected-prompt">
                                    <SelectValue />
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {Object.values(PROMPT_PRESETS).map(
                                        (preset) => (
                                            <SelectItem
                                                key={preset.id}
                                                value={preset.id}
                                            >
                                                {preset.name}
                                            </SelectItem>
                                        ),
                                    )}
                                    {customPrompts.map((prompt) => (
                                        <SelectItem
                                            key={prompt.id}
                                            value={prompt.id}
                                        >
                                            {prompt.name} (yours)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                </SettingsRows>
            )}

            <PromptList
                title="Built-in title prompts"
                items={Object.values(PROMPT_PRESETS).map((preset) => ({
                    id: preset.id,
                    name: preset.name,
                    description: preset.description,
                    active: selectedPromptId === preset.id,
                }))}
                onView={setViewingPromptId}
            />

            <PromptList
                title="Your title prompts"
                emptyText="None yet. Write one when the built-in prompts don't fit"
                addLabel="New prompt"
                onAdd={() => setEditingCustomPrompt({ name: "", prompt: "" })}
                items={customPrompts.map((prompt) => ({
                    id: prompt.id,
                    name: prompt.name,
                    active: selectedPromptId === prompt.id,
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
                            Create a custom prompt for title generation. Use{" "}
                            <code className="px-1 py-0.5 bg-muted rounded">
                                {"{transcription}"}
                            </code>{" "}
                            as a placeholder for the transcription text.
                        </DialogDescription>
                        <div className="space-y-4 mt-4">
                            <div className="space-y-2">
                                <Label htmlFor="custom-prompt-name">Name</Label>
                                <Input
                                    id="custom-prompt-name"
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
                                <Label htmlFor="custom-prompt-text">
                                    Prompt
                                </Label>
                                <textarea
                                    id="custom-prompt-text"
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
                                    placeholder={`You are a title generator for audio recordings. Generate a concise, descriptive title based on the transcription provided.

RULES (MUST FOLLOW):
1. Maximum 60 characters (strict limit)
2. No quotes, colons, semicolons, or special punctuation marks
3. Use title case (capitalize important words)
4. Focus on the main topic, subject, or action discussed
5. Remove filler words, greetings, and conversational fluff
6. Be specific and descriptive, not generic
7. If the transcription is very short or unclear, create a meaningful title based on context
8. Do not include timestamps, dates, or metadata
9. Do not use phrases like "Recording about" or "Discussion of"
10. Return ONLY the title text, nothing else

Transcription:
{transcription}

Generate the title now:`}
                                />
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
