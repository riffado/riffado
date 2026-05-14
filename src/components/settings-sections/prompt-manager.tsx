"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
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
import { useSettings } from "@/hooks/use-settings";
import { PROMPT_PRESETS } from "@/lib/ai/prompt-presets";

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

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

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
        <div className="space-y-6">
            {/* Active prompt selector */}
            <div className="space-y-2">
                <Label htmlFor="selected-prompt">Active Prompt</Label>
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
                    <SelectTrigger id="selected-prompt">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.values(PROMPT_PRESETS).map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                                {preset.name} (Preset)
                            </SelectItem>
                        ))}
                        {customPrompts.map((prompt) => (
                            <SelectItem key={prompt.id} value={prompt.id}>
                                {prompt.name} (Custom)
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Select which prompt to use for title generation
                </p>
            </div>

            {/* Preset prompts (read-only) */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Preset Prompts</h3>
                </div>
                <div className="space-y-2">
                    {Object.values(PROMPT_PRESETS).map((preset) => (
                        <div key={preset.id} className="p-4 border rounded-lg">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-medium">
                                            {preset.name}
                                        </h4>
                                        {selectedPromptId === preset.id && (
                                            <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        {preset.description}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setViewingPromptId(preset.id)
                                    }
                                >
                                    View Prompt
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Custom prompts */}
            <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Custom Prompts</h3>
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
                                            {selectedPromptId === prompt.id && (
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
        </div>
    );
}
