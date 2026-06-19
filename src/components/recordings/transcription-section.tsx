"use client";

import {
    ChevronDown,
    ChevronUp,
    ListChecks,
    Loader2,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import { SUMMARY_PRESETS } from "@/lib/ai/summary-presets";

interface TranscriptionSectionProps {
    recordingId: string;
    initialTranscription?: string;
    initialLanguage?: string | null;
    initialType?: string | null;
}

export function TranscriptionSection({
    recordingId,
    initialTranscription,
    initialLanguage,
    initialType,
}: TranscriptionSectionProps) {
    const [transcription, setTranscription] = useState(initialTranscription);
    const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
    const [transcriptionType, setTranscriptionType] = useState(initialType);
    const [isProcessing, setIsProcessing] = useState(false);

    const {
        summaryData,
        isSummarizing,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        customPrompts,
        handleSummarize,
        handleDeleteSummary,
        refetchSummary,
    } = useTranscriptionSummary({
        recordingId,
        transcriptionText: transcription,
    });

    const handleTranscribe = async () => {
        setIsProcessing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/transcribe`,
                {
                    method: "POST",
                },
            );

            if (!response.ok) {
                const errorData = await response.json();
                if (
                    response.status === 400 &&
                    errorData.error?.includes("No transcription API")
                ) {
                    toast.error(
                        "Please configure an AI provider in Settings first",
                    );
                } else {
                    toast.error(errorData.error || "Transcription failed");
                }
                return;
            }

            const data = await response.json();
            setTranscription(data.transcription);
            setDetectedLanguage(data.detectedLanguage);
            setTranscriptionType("server");
            // Force a summary re-fetch -- the server may have already
            // auto-summarized. The hook also handles text-change
            // invalidation via its internal ref, but we trigger here
            // explicitly because we own the transcription state and
            // know the moment it changes.
            refetchSummary();
            toast.success("Transcription complete");
        } catch {
            toast.error("Transcription failed. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Transcription Panel */}
            <Panel>
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-semibold">
                                Transcription
                            </h2>
                            {detectedLanguage && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset">
                                    <LEDIndicator
                                        active
                                        status="active"
                                        size="sm"
                                    />
                                    <span className="text-label text-xs">
                                        Lang:{" "}
                                        <span className="font-mono uppercase text-accent-cyan">
                                            {detectedLanguage}
                                        </span>
                                    </span>
                                </div>
                            )}
                            {transcriptionType && (
                                <span className="text-label text-xs px-3 py-1.5 rounded-lg bg-panel-inset border border-panel-border">
                                    {transcriptionType}
                                </span>
                            )}
                        </div>
                        <MetalButton
                            onClick={handleTranscribe}
                            variant="cyan"
                            disabled={isProcessing}
                            className="w-full md:w-auto"
                        >
                            {isProcessing
                                ? "Processing…"
                                : transcription
                                  ? "Re-transcribe"
                                  : "Transcribe"}
                        </MetalButton>
                    </div>

                    {transcription ? (
                        <div className="info-card">
                            <p className="whitespace-pre-wrap leading-relaxed">
                                {transcription}
                            </p>
                        </div>
                    ) : (
                        <Panel variant="inset" className="text-center py-12">
                            <LEDIndicator
                                active={false}
                                status="active"
                                size="md"
                                className="mx-auto mb-4"
                            />
                            <p className="text-muted-foreground mb-2">
                                No transcription yet
                            </p>
                            <p className="text-sm text-text-muted">
                                Click &quot;Transcribe&quot; to generate a
                                transcription
                            </p>
                        </Panel>
                    )}
                </div>
            </Panel>

            {/* Summary Panel -- only show when transcription exists */}
            {transcription && (
                <Panel>
                    <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-semibold">
                                    Summary
                                </h2>
                            </div>
                            <div className="flex items-center gap-2">
                                {!isSummarizing && (
                                    <Select
                                        value={summaryPreset}
                                        onValueChange={setSummaryPreset}
                                    >
                                        <SelectTrigger className="w-[160px] h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.values(SUMMARY_PRESETS).map(
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
                                                    {prompt.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                <MetalButton
                                    onClick={handleSummarize}
                                    variant="cyan"
                                    disabled={isSummarizing}
                                    className="w-full md:w-auto"
                                >
                                    {isSummarizing ? (
                                        <>
                                            <Loader2 className="size-4 mr-2 animate-spin inline" />
                                            Generating…
                                        </>
                                    ) : summaryData ? (
                                        <>
                                            <RefreshCw className="size-4 mr-2 inline" />
                                            Re-generate
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-4 mr-2 inline" />
                                            Summarize
                                        </>
                                    )}
                                </MetalButton>
                            </div>
                        </div>

                        {isSummarizing ? (
                            <Panel variant="inset" className="text-center py-8">
                                <Loader2 className="size-8 animate-spin text-accent-cyan mx-auto mb-4" />
                                <p className="text-muted-foreground">
                                    Generating summary…
                                </p>
                            </Panel>
                        ) : summaryData?.summary ? (
                            <div className="space-y-4">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSummaryExpanded(!summaryExpanded)
                                    }
                                    className="flex items-center gap-1 text-sm font-medium hover:text-accent-cyan transition-colors"
                                >
                                    {summaryExpanded ? (
                                        <ChevronUp className="size-4" />
                                    ) : (
                                        <ChevronDown className="size-4" />
                                    )}
                                    {summaryExpanded
                                        ? "Collapse"
                                        : "Expand summary"}
                                </button>

                                {summaryExpanded && (
                                    <div className="space-y-4">
                                        <div className="info-card">
                                            <p className="leading-relaxed">
                                                {summaryData.summary}
                                            </p>
                                        </div>

                                        {summaryData.keyPoints &&
                                            summaryData.keyPoints.length >
                                                0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2">
                                                        Key Points
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {summaryData.keyPoints.map(
                                                            (point) => {
                                                                const key = `kp-${point.slice(0, 32)}`;
                                                                return (
                                                                    <li
                                                                        key={
                                                                            key
                                                                        }
                                                                        className="text-sm text-muted-foreground flex items-start gap-2"
                                                                    >
                                                                        <span className="mt-1.5 size-1.5 rounded-full bg-accent-cyan shrink-0" />
                                                                        {point}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {summaryData.actionItems &&
                                            summaryData.actionItems.length >
                                                0 && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2">
                                                        Action Items
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {summaryData.actionItems.map(
                                                            (item) => {
                                                                const key = `ai-${item.slice(0, 32)}`;
                                                                return (
                                                                    <li
                                                                        key={
                                                                            key
                                                                        }
                                                                        className="text-sm text-muted-foreground flex items-start gap-2"
                                                                    >
                                                                        <ListChecks className="size-3.5 mt-0.5 text-accent-cyan shrink-0" />
                                                                        {item}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        <div className="flex items-center justify-between pt-2 border-t border-panel-border">
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                {summaryData.provider && (
                                                    <span className="px-2 py-0.5 rounded bg-panel-inset">
                                                        {summaryData.provider}
                                                    </span>
                                                )}
                                                {summaryData.model && (
                                                    <span className="px-2 py-0.5 rounded bg-panel-inset font-mono">
                                                        {summaryData.model}
                                                    </span>
                                                )}
                                            </div>
                                            <MetalButton
                                                onClick={handleDeleteSummary}
                                                variant="cyan"
                                                className="text-xs"
                                            >
                                                <Trash2 className="size-3.5 mr-1 inline" />
                                                Delete
                                            </MetalButton>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Panel variant="inset" className="text-center py-8">
                                <ListChecks className="size-10 text-muted-foreground mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    No summary yet. Click &quot;Summarize&quot;
                                    to generate one.
                                </p>
                            </Panel>
                        )}
                    </div>
                </Panel>
            )}
        </div>
    );
}
