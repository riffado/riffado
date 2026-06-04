"use client";

import {
    ChevronDown,
    ChevronUp,
    FileText,
    Languages,
    ListChecks,
    Loader2,
    Map,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { MemoryMap } from "@/components/dashboard/memory-map";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import { SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import type { Recording } from "@/types/recording";

interface Transcription {
    text?: string;
    language?: string;
}

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    onTranscribe: () => void;
    showTranscript?: boolean;
    showSummary?: boolean;
}

export function TranscriptionPanel({
    recording,
    transcription,
    isTranscribing,
    onTranscribe,
    showTranscript = true,
    showSummary = true,
}: TranscriptionPanelProps) {
    const {
        summaryData,
        isSummarizing,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        handleSummarize,
        handleDeleteSummary,
    } = useTranscriptionSummary({
        recordingId: recording?.id,
        transcriptionText: transcription?.text,
    });

    const wordCount = transcription?.text?.trim()
        ? transcription.text.trim().split(/\s+/).length
        : 0;

    return (
        <div className="space-y-3">
            {/* ── Transcription ─────────────────────────────────── */}
            {showTranscript && <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <FileText className="size-4 text-muted-foreground" />
                            Transcription
                            {transcription?.text && (
                                <span className="font-normal text-xs text-muted-foreground/70 font-mono">
                                    {wordCount.toLocaleString()} words
                                </span>
                            )}
                        </CardTitle>
                        <div className="flex items-center gap-2 shrink-0">
                            {transcription?.text && (
                                <Button
                                    onClick={onTranscribe}
                                    size="sm"
                                    variant="ghost"
                                    disabled={isTranscribing}
                                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <RefreshCw className="size-3" />
                                    Re-run
                                </Button>
                            )}
                            {!transcription?.text && !isTranscribing && (
                                <Button
                                    onClick={onTranscribe}
                                    size="sm"
                                    variant="default"
                                    disabled={isTranscribing}
                                    className="h-7 gap-1.5 text-xs"
                                >
                                    <Sparkles className="size-3" />
                                    Transcribe
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isTranscribing ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-12">
                            <Loader2 className="size-6 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">
                                Transcribing audio…
                            </p>
                        </div>
                    ) : transcription?.text ? (
                        <div className="space-y-3">
                            <div className="rounded-lg bg-muted/60 p-4 max-h-96 overflow-y-auto border border-border/50 dark:bg-muted/30">
                                <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                                    {transcription.text}
                                </p>
                            </div>
                            {transcription.language && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                                    <Languages className="size-3" />
                                    <span className="font-mono">{transcription.language}</span>
                                    <span className="opacity-40 mx-1">·</span>
                                    <span>{transcription.text.length.toLocaleString()} chars</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                            <div className="rounded-full bg-muted/60 p-3">
                                <FileText className="size-5 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                No transcription yet
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>}

            {/* ── Summary ───────────────────────────────────────── */}
            {showSummary && transcription?.text && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Sparkles className="size-4 text-muted-foreground" />
                                Summary
                            </CardTitle>
                            <div className="flex items-center gap-2 shrink-0">
                                {!isSummarizing && (
                                    <Select value={summaryPreset} onValueChange={setSummaryPreset}>
                                        <SelectTrigger className="h-7 w-[140px] text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.values(SUMMARY_PRESETS).map((preset) => (
                                                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                                                    {preset.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                <Button
                                    onClick={handleSummarize}
                                    size="sm"
                                    variant={summaryData ? "ghost" : "default"}
                                    disabled={isSummarizing}
                                    className="h-7 gap-1.5 text-xs"
                                >
                                    {isSummarizing ? (
                                        <>
                                            <Loader2 className="size-3 animate-spin" />
                                            Generating…
                                        </>
                                    ) : summaryData ? (
                                        <>
                                            <RefreshCw className="size-3" />
                                            Re-generate
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-3" />
                                            Summarize
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isSummarizing ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-10">
                                <Loader2 className="size-6 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Generating summary…</p>
                            </div>
                        ) : summaryData?.summary ? (
                            <div className="space-y-3">
                                <button
                                    type="button"
                                    onClick={() => setSummaryExpanded(!summaryExpanded)}
                                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {summaryExpanded ? (
                                        <ChevronUp className="size-3.5" />
                                    ) : (
                                        <ChevronDown className="size-3.5" />
                                    )}
                                    {summaryExpanded ? "Collapse" : "Expand summary"}
                                </button>

                                {summaryExpanded && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <div className="rounded-lg bg-muted/60 border border-border/50 p-4 dark:bg-muted/30">
                                            <p className="text-sm leading-relaxed text-foreground/90">
                                                {summaryData.summary}
                                            </p>
                                        </div>

                                        {summaryData.keyPoints && summaryData.keyPoints.length > 0 && (
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">
                                                    Key Points
                                                </h4>
                                                <ul className="space-y-1.5">
                                                    {summaryData.keyPoints.map((point) => (
                                                        <li
                                                            key={`kp-${point.slice(0, 32)}`}
                                                            className="flex items-start gap-2.5 text-sm text-foreground/80"
                                                        >
                                                            <span className="mt-2 size-1.5 rounded-full bg-primary shrink-0" />
                                                            {point}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {summaryData.actionItems && summaryData.actionItems.length > 0 && (
                                            <div className="space-y-2">
                                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">
                                                    Action Items
                                                </h4>
                                                <ul className="space-y-1.5">
                                                    {summaryData.actionItems.map((item) => (
                                                        <li
                                                            key={`ai-${item.slice(0, 32)}`}
                                                            className="flex items-start gap-2.5 text-sm text-foreground/80"
                                                        >
                                                            <ListChecks className="size-3.5 mt-0.5 text-primary shrink-0" />
                                                            {item}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Memory Map */}
                                        {summaryData.summary && (
                                            <MemoryMap
                                                title={recording.filename ?? "Recording"}
                                                summary={summaryData.summary}
                                                keyPoints={summaryData.keyPoints}
                                                actionItems={summaryData.actionItems}
                                            />
                                        )}

                                        <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                            <div className="flex items-center gap-2">
                                                {summaryData.provider && (
                                                    <span className="rounded bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground font-mono">
                                                        {summaryData.provider}
                                                    </span>
                                                )}
                                                {summaryData.model && (
                                                    <span className="rounded bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground font-mono">
                                                        {summaryData.model}
                                                    </span>
                                                )}
                                            </div>
                                            <Button
                                                onClick={handleDeleteSummary}
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                                            >
                                                <Trash2 className="size-3" />
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                                <div className="rounded-full bg-muted/60 p-3">
                                    <Sparkles className="size-5 text-muted-foreground/50" />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    No summary yet
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
