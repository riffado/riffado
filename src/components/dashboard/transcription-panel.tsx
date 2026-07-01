"use client";

import {
    ChevronDown,
    ChevronUp,
    Cpu,
    FileText,
    Languages,
    ListChecks,
    Loader2,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTranscriptionSummary } from "@/hooks/use-transcription-summary";
import { SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import type { Recording } from "@/types/recording";
import type { TranscriptionModel } from "@/types/transcription";

interface Transcription {
    text?: string;
    language?: string;
}

const BROWSER_MODELS: {
    model: TranscriptionModel;
    label: string;
    hint: string;
}[] = [
    { model: "whisper-tiny", label: "Whisper Tiny", hint: "fastest, ~75 MB" },
    { model: "whisper-base", label: "Whisper Base", hint: "balanced, ~145 MB" },
    {
        model: "whisper-small",
        label: "Whisper Small",
        hint: "most accurate, ~485 MB",
    },
];

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    onTranscribe: () => void;
    /**
     * Run transcription in the browser via Transformers.js with the
     * chosen Whisper model. Optional -- when omitted, only the
     * server-side path is offered.
     */
    onTranscribeBrowser?: (model: TranscriptionModel) => void;
    /** Human-readable progress string while a browser transcribe runs. */
    browserStatus?: string | null;
}

export function TranscriptionPanel({
    recording,
    transcription,
    isTranscribing,
    onTranscribe,
    onTranscribeBrowser,
    browserStatus,
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

    return (
        <div className="space-y-4">
            {/* Transcription Card */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="size-5" />
                            Transcription
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            {transcription?.text ? (
                                <Button
                                    onClick={onTranscribe}
                                    size="sm"
                                    variant="outline"
                                    disabled={isTranscribing}
                                >
                                    <RefreshCw className="size-4 mr-2" />
                                    Re-transcribe
                                </Button>
                            ) : (
                                !isTranscribing && (
                                    <Button
                                        onClick={onTranscribe}
                                        size="sm"
                                        disabled={isTranscribing}
                                    >
                                        <Sparkles className="size-4 mr-2" />
                                        Transcribe
                                    </Button>
                                )
                            )}
                            {onTranscribeBrowser && !isTranscribing && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label="Transcribe in browser"
                                        >
                                            <Cpu className="size-4 mr-2" />
                                            In browser
                                            <ChevronDown className="size-4 ml-1" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>
                                            Transcribe in browser (free)
                                        </DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {BROWSER_MODELS.map(
                                            ({ model, label, hint }) => (
                                                <DropdownMenuItem
                                                    key={model}
                                                    onClick={() =>
                                                        onTranscribeBrowser(
                                                            model,
                                                        )
                                                    }
                                                    className="flex flex-col items-start gap-0.5"
                                                >
                                                    <span>{label}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {hint}
                                                    </span>
                                                </DropdownMenuItem>
                                            ),
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isTranscribing ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                            <p className="text-sm text-muted-foreground">
                                {browserStatus ?? "Transcribing audio…"}
                            </p>
                            {browserStatus && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Running in your browser — nothing leaves
                                    this device.
                                </p>
                            )}
                        </div>
                    ) : transcription?.text ? (
                        <div className="space-y-4">
                            <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
                                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                    {transcription.text}
                                </p>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                                {transcription.language && (
                                    <div className="flex items-center gap-1">
                                        <Languages className="size-3" />
                                        <span>
                                            Language: {transcription.language}
                                        </span>
                                    </div>
                                )}
                                <div>
                                    {transcription.text.trim()
                                        ? transcription.text.trim().split(/\s+/)
                                              .length
                                        : 0}{" "}
                                    words
                                </div>
                                <div>
                                    {transcription.text.length} characters
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                            <FileText className="size-10 text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">
                                No transcription yet. Use the Transcribe button
                                above.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Summary Card -- only show when transcription exists */}
            {transcription?.text && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <ListChecks className="size-5" />
                                Summary
                            </CardTitle>
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
                                        </SelectContent>
                                    </Select>
                                )}
                                <Button
                                    onClick={handleSummarize}
                                    size="sm"
                                    variant={
                                        summaryData ? "outline" : "default"
                                    }
                                    disabled={isSummarizing}
                                >
                                    {isSummarizing ? (
                                        <>
                                            <Loader2 className="size-4 mr-2 animate-spin" />
                                            Generating…
                                        </>
                                    ) : summaryData ? (
                                        <>
                                            <RefreshCw className="size-4 mr-2" />
                                            Re-generate
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-4 mr-2" />
                                            Summarize
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isSummarizing ? (
                            <div className="flex flex-col items-center justify-center py-8">
                                <Loader2 className="size-8 animate-spin text-primary mb-4" />
                                <p className="text-sm text-muted-foreground">
                                    Generating summary…
                                </p>
                            </div>
                        ) : summaryData?.summary ? (
                            <div className="space-y-4">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSummaryExpanded(!summaryExpanded)
                                    }
                                    className="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
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
                                        {/* Summary text */}
                                        <div className="bg-muted rounded-lg p-4">
                                            <p className="text-sm leading-relaxed">
                                                {summaryData.summary}
                                            </p>
                                        </div>

                                        {/* Key points */}
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
                                                                        <span className="text-primary mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                                                                        {point}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {/* Action items */}
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
                                                                        <ListChecks className="size-3.5 mt-0.5 text-primary shrink-0" />
                                                                        {item}
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {/* Meta + Delete */}
                                        <div className="flex items-center justify-between pt-2 border-t">
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                {summaryData.provider && (
                                                    <span className="px-2 py-0.5 rounded bg-muted">
                                                        {summaryData.provider}
                                                    </span>
                                                )}
                                                {summaryData.model && (
                                                    <span className="px-2 py-0.5 rounded bg-muted font-mono">
                                                        {summaryData.model}
                                                    </span>
                                                )}
                                            </div>
                                            <Button
                                                onClick={handleDeleteSummary}
                                                size="sm"
                                                variant="ghost"
                                                className="text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="size-4 mr-1" />
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                <ListChecks className="size-10 text-muted-foreground mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    No summary yet. Click "Summarize" to
                                    generate one.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
