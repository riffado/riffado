"use client";

import {
    ChevronDown,
    ChevronUp,
    ListChecks,
    Loader2,
    Plus,
    RefreshCw,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    getAllSummaryPrompts,
    getDefaultSummaryPromptConfig,
    SUMMARY_PRESETS,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";

interface SummaryData {
    id: string;
    summary: string | null;
    keyPoints: string[] | null;
    actionItems: string[] | null;
    provider?: string;
    model?: string;
    presetId: string;
    createdAt: string;
}

interface SummaryTabsProps {
    recordingId: string;
    fetchKey?: number;
}

function getPresetName(
    presetId: string,
    config: SummaryPromptConfiguration,
): string {
    if (presetId in SUMMARY_PRESETS) {
        return SUMMARY_PRESETS[presetId as keyof typeof SUMMARY_PRESETS].name;
    }
    const custom = config.customPrompts.find((p) => p.id === presetId);
    return custom?.name || presetId;
}

export function SummaryTabs({ recordingId, fetchKey = 0 }: SummaryTabsProps) {
    const [summaries, setSummaries] = useState<SummaryData[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState("general");
    const [expanded, setExpanded] = useState(true);
    const [promptConfig, setPromptConfig] =
        useState<SummaryPromptConfiguration>(getDefaultSummaryPromptConfig());

    const activeSummary = useMemo(
        () => summaries.find((s) => s.id === activeId) || summaries[0] || null,
        [summaries, activeId],
    );

    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;

    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchKey is an intentional re-fetch signal passed from parent
    useEffect(() => {
        setIsLoading(true);
        setSummaries([]);
        const controller = new AbortController();

        fetch(`/api/recordings/${recordingId}/summary`, {
            signal: controller.signal,
        })
            .then((res) => res.json())
            .then((data: { summaries?: SummaryData[] }) => {
                const list = data.summaries || [];
                setSummaries(list);
                if (
                    list.length > 0 &&
                    !list.find((s) => s.id === activeIdRef.current)
                ) {
                    setActiveId(list[0].id);
                }
                if (list.length === 0) {
                    setActiveId(null);
                }
            })
            .catch(() => {})
            .finally(() => setIsLoading(false));

        return () => controller.abort();
    }, [recordingId, fetchKey]);

    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/settings/user", { signal: controller.signal })
            .then((res) => res.json())
            .then((settings) => {
                if (settings?.summaryPrompt) {
                    setPromptConfig({
                        selectedPrompt:
                            settings.summaryPrompt.selectedPrompt || "general",
                        customPrompts:
                            settings.summaryPrompt.customPrompts || [],
                    });
                }
            })
            .catch(() => {});
        return () => controller.abort();
    }, []);

    const handleGenerateNew = useCallback(async () => {
        setModalOpen(false);
        setIsGenerating(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/summary`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: selectedPreset }),
                },
            );

            if (response.ok) {
                const data = await response.json();
                const newSummary: SummaryData = {
                    id: data.id || crypto.randomUUID(),
                    summary: data.summary,
                    keyPoints: data.keyPoints,
                    actionItems: data.actionItems,
                    provider: data.provider,
                    model: data.model,
                    presetId: data.presetId || selectedPreset,
                    createdAt: data.createdAt || new Date().toISOString(),
                };
                setSummaries((prev) => [...prev, newSummary]);
                setActiveId(newSummary.id);
                toast.success("Summary generated");
            } else {
                const error = await response.json();
                toast.error(error.error || "Summary generation failed");
            }
        } catch {
            toast.error("Failed to generate summary");
        } finally {
            setIsGenerating(false);
        }
    }, [recordingId, selectedPreset]);

    const handleRegenerate = useCallback(
        async (summaryId: string) => {
            setIsRegenerating(true);
            try {
                const summary = summaries.find((s) => s.id === summaryId);
                const response = await fetch(
                    `/api/recordings/${recordingId}/summary`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            summaryId,
                            preset: summary?.presetId,
                        }),
                    },
                );

                if (response.ok) {
                    const data = await response.json();
                    setSummaries((prev) =>
                        prev.map((s) =>
                            s.id === summaryId
                                ? {
                                      ...s,
                                      summary: data.summary,
                                      keyPoints: data.keyPoints,
                                      actionItems: data.actionItems,
                                      provider: data.provider,
                                      model: data.model,
                                      presetId: data.presetId || s.presetId,
                                      createdAt: data.createdAt || s.createdAt,
                                  }
                                : s,
                        ),
                    );
                    toast.success("Summary regenerated");
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Regeneration failed");
                }
            } catch {
                toast.error("Failed to regenerate summary");
            } finally {
                setIsRegenerating(false);
            }
        },
        [recordingId, summaries],
    );

    const handleDelete = useCallback(
        async (summaryId: string) => {
            const previous = summaries;
            setIsDeleting(true);
            setSummaries((prev) => prev.filter((s) => s.id !== summaryId));
            if (activeId === summaryId) {
                const next = summaries.find((s) => s.id !== summaryId);
                setActiveId(next?.id || null);
            }

            try {
                const response = await fetch(
                    `/api/recordings/${recordingId}/summary?summaryId=${summaryId}`,
                    { method: "DELETE" },
                );

                if (response.ok) {
                    toast.success("Summary deleted");
                } else {
                    setSummaries(previous);
                    if (activeId === summaryId) {
                        setActiveId(summaryId);
                    }
                    toast.error("Failed to delete summary");
                }
            } catch {
                setSummaries(previous);
                if (activeId === summaryId) {
                    setActiveId(summaryId);
                }
                toast.error("Failed to delete summary");
            } finally {
                setIsDeleting(false);
            }
        },
        [recordingId, summaries, activeId],
    );

    const allPrompts = useMemo(
        () => getAllSummaryPrompts(promptConfig),
        [promptConfig],
    );

    const firstGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/summary`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                },
            );

            if (response.ok) {
                const data = await response.json();
                const newSummary: SummaryData = {
                    id: data.id || crypto.randomUUID(),
                    summary: data.summary,
                    keyPoints: data.keyPoints,
                    actionItems: data.actionItems,
                    provider: data.provider,
                    model: data.model,
                    presetId: data.presetId || "general",
                    createdAt: data.createdAt || new Date().toISOString(),
                };
                setSummaries([newSummary]);
                setActiveId(newSummary.id);
                toast.success("Summary generated");
            } else {
                const error = await response.json();
                toast.error(error.error || "Summary generation failed");
            }
        } catch {
            toast.error("Failed to generate summary");
        } finally {
            setIsGenerating(false);
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-8 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                        Loading summaries...
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (summaries.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <ListChecks className="w-5 h-5" />
                            Summary
                        </CardTitle>
                        <Button
                            onClick={firstGenerate}
                            size="sm"
                            disabled={isGenerating}
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Summarize
                                </>
                            )}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {isGenerating ? (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                            <p className="text-sm text-muted-foreground">
                                Generating summary...
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                            <ListChecks className="w-10 h-10 text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">
                                No summary yet. Click Summarize to generate one.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <ListChecks className="w-5 h-5" />
                        Summaries
                    </CardTitle>
                </div>
                <div className="flex items-center gap-2 mt-3">
                    <div
                        className="flex items-center gap-2 overflow-x-auto pb-1 flex-1 [&::-webkit-scrollbar]:hidden"
                        style={{
                            scrollbarWidth: "none",
                            msOverflowStyle: "none",
                        }}
                    >
                        {summaries.map((summary) => {
                            const isActive = summary.id === activeId;
                            const name = getPresetName(
                                summary.presetId,
                                promptConfig,
                            );
                            return (
                                <div
                                    key={summary.id}
                                    role="tab"
                                    aria-selected={isActive}
                                    tabIndex={0}
                                    onClick={() => setActiveId(summary.id)}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault();
                                            setActiveId(summary.id);
                                        }
                                    }}
                                    className={`
                                    flex items-center gap-2 px-3 py-1.5 rounded-md text-sm
                                    transition-colors whitespace-nowrap shrink-0 cursor-pointer
                                    ${
                                        isActive
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                    }
                                `}
                                >
                                    <span>{name}</span>
                                    <span
                                        className={`text-xs opacity-60 ${
                                            isActive
                                                ? "text-primary-foreground"
                                                : ""
                                        }`}
                                    >
                                        {new Date(
                                            summary.createdAt,
                                        ).toLocaleDateString()}
                                    </span>
                                    {summaries.length > 1 && (
                                        <button
                                            type="button"
                                            aria-label="Delete summary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(summary.id);
                                            }}
                                            className="ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-opacity"
                                            disabled={isDeleting}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 h-8 px-2"
                        onClick={() => setModalOpen(true)}
                        disabled={isGenerating}
                    >
                        <Plus className="w-4 h-4" />
                    </Button>
                </div>
            </CardHeader>

            <CardContent>
                {isGenerating && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Generating new summary...
                        </p>
                    </div>
                )}
                {!isGenerating && activeSummary && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpanded(!expanded)}
                                className="text-sm"
                            >
                                {expanded ? (
                                    <>
                                        <ChevronUp className="w-4 h-4 mr-1" />
                                        Collapse
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="w-4 h-4 mr-1" />
                                        Expand
                                    </>
                                )}
                            </Button>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        handleRegenerate(activeSummary.id)
                                    }
                                    disabled={isRegenerating}
                                >
                                    {isRegenerating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Regenerating...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            Re-generate
                                        </>
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() =>
                                        handleDelete(activeSummary.id)
                                    }
                                    disabled={isDeleting}
                                >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    Delete
                                </Button>
                            </div>
                        </div>

                        {expanded && (
                            <>
                                <div className="bg-muted rounded-lg p-4">
                                    <p className="text-sm leading-relaxed">
                                        {activeSummary.summary ||
                                            "No summary text available."}
                                    </p>
                                </div>

                                {activeSummary.keyPoints &&
                                    activeSummary.keyPoints.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-medium mb-2">
                                                Key Points
                                            </h4>
                                            <ul className="space-y-1">
                                                {activeSummary.keyPoints.map(
                                                    (point, index) => {
                                                        const key = `kp-${index}`;
                                                        return (
                                                            <li
                                                                key={key}
                                                                className="text-sm text-muted-foreground flex items-start gap-2"
                                                            >
                                                                <span className="text-primary mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                                                {point}
                                                            </li>
                                                        );
                                                    },
                                                )}
                                            </ul>
                                        </div>
                                    )}

                                {activeSummary.actionItems &&
                                    activeSummary.actionItems.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-medium mb-2">
                                                Action Items
                                            </h4>
                                            <ul className="space-y-1">
                                                {activeSummary.actionItems.map(
                                                    (item, index) => {
                                                        const key = `ai-${index}`;
                                                        return (
                                                            <li
                                                                key={key}
                                                                className="text-sm text-muted-foreground flex items-start gap-2"
                                                            >
                                                                <ListChecks className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                                                                {item}
                                                            </li>
                                                        );
                                                    },
                                                )}
                                            </ul>
                                        </div>
                                    )}

                                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
                                    {activeSummary.provider && (
                                        <span className="px-2 py-0.5 rounded bg-muted">
                                            {activeSummary.provider}
                                        </span>
                                    )}
                                    {activeSummary.model && (
                                        <span className="px-2 py-0.5 rounded bg-muted font-mono">
                                            {activeSummary.model}
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </CardContent>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Generate New Summary</DialogTitle>
                        <DialogDescription>
                            Choose a template to create an additional summary
                            for this recording.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Select
                            value={selectedPreset}
                            onValueChange={setSelectedPreset}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {allPrompts.map((prompt) => (
                                    <SelectItem
                                        key={prompt.id}
                                        value={prompt.id}
                                    >
                                        {prompt.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleGenerateNew}>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Generate
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
