"use client";

import {
    ChevronDown,
    ChevronUp,
    FileText,
    Languages,
    ListChecks,
    Loader2,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { GenerateButton } from "@/components/dashboard/generate-button";
import {
    type GenerateConfig,
    GenerateOptionsMenu,
} from "@/components/dashboard/generate-options-menu";
import {
    GeneratePipeline,
    type PipelineStage,
} from "@/components/dashboard/generate-pipeline";
import { MemoryMap } from "@/components/dashboard/memory-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface Transcription {
    text?: string;
    language?: string;
}

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    onTranscribe: (providerId?: string, model?: string) => void;
    showTranscript?: boolean;
    showSummary?: boolean;
    /** Called by the pipeline when generation completes to auto-switch tab. */
    onPipelineComplete?: () => void;
    /**
     * Called after any successful generation (transcription and/or summary)
     * so the parent can refresh server data — otherwise the freshly created
     * transcript/summary won't appear without a manual page reload.
     */
    onGenerated?: () => void;
}

export function TranscriptionPanel({
    recording,
    transcription,
    isTranscribing,
    onTranscribe,
    showTranscript = true,
    showSummary = true,
    onPipelineComplete,
    onGenerated,
}: TranscriptionPanelProps) {
    const {
        summaryData,
        isSummarizing,
        summaryExpanded,
        setSummaryExpanded,
        summaryPreset,
        setSummaryPreset,
        handleDeleteSummary,
        refetchSummary,
    } = useTranscriptionSummary({
        recordingId: recording?.id,
        transcriptionText: transcription?.text,
    });

    // ── Generate pipeline state ──────────────────────────────────
    const [showOptions, setShowOptions] = useState(false);
    // Re-generate option menus (transcription / summary) — open on demand
    // from the card headers so the user can pick a server, model, template
    // and language before re-running, just like first-time generation.
    const [showReTranscribeOptions, setShowReTranscribeOptions] =
        useState(false);
    const [showReSummarizeOptions, setShowReSummarizeOptions] = useState(false);
    const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
    const [pipelineError, setPipelineError] = useState<string | null>(null);

    const isGenerating =
        pipelineStage === "transcribing" || pipelineStage === "summarizing";

    // ── Run the full pipeline: transcribe → summarize ────────────
    const runPipeline = useCallback(
        async (config?: GenerateConfig | null) => {
            setShowOptions(false);
            setPipelineStage("transcribing");
            setPipelineError(null);

            try {
                // Step 1: Transcribe
                const transcribeBody: Record<string, unknown> = {};
                if (config?.transcriptionProviderId) {
                    transcribeBody.providerId = config.transcriptionProviderId;
                }
                if (config?.transcriptionModel) {
                    transcribeBody.model = config.transcriptionModel;
                }

                const transcribeRes = await fetch(
                    `/api/recordings/${recording.id}/transcribe`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(transcribeBody),
                    },
                );

                if (!transcribeRes.ok) {
                    const errData = await transcribeRes
                        .json()
                        .catch(() => ({}));
                    throw new Error(
                        errData.error ||
                            `Transcription failed (${transcribeRes.status})`,
                    );
                }

                // Step 2: Summarize
                setPipelineStage("summarizing");

                const summaryBody: Record<string, unknown> = {
                    preset: config?.summaryPreset || "general",
                };
                if (config?.language && config.language !== "auto") {
                    summaryBody.language = config.language;
                }

                const summaryRes = await fetch(
                    `/api/recordings/${recording.id}/summary`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(summaryBody),
                    },
                );

                if (!summaryRes.ok) {
                    const errData = await summaryRes.json().catch(() => ({}));
                    throw new Error(
                        errData.error ||
                            `Summary failed (${summaryRes.status})`,
                    );
                }

                // Done!
                setPipelineStage("complete");
                toast.success("Transcription and summary complete!");

                // Refresh server data now (during the complete animation) so
                // the new transcript + summary are available when we switch
                // to the Notes tab — without a manual page reload.
                onGenerated?.();

                // Auto-switch to Notes tab after a brief moment
                setTimeout(() => {
                    setPipelineStage("idle");
                    onPipelineComplete?.();
                }, 1800);
            } catch (err) {
                setPipelineStage("error");
                const msg =
                    err instanceof Error ? err.message : "Pipeline failed";
                setPipelineError(msg);
                toast.error(msg);

                // Reset after showing the error
                setTimeout(() => setPipelineStage("idle"), 5000);
            }
        },
        [recording.id, onPipelineComplete, onGenerated],
    );

    const handleAutoGenerate = useCallback(() => {
        runPipeline(null);
    }, [runPipeline]);

    const handleConfiguredGenerate = useCallback(
        (config: GenerateConfig) => {
            runPipeline(config);
        },
        [runPipeline],
    );

    // ── Re-generate transcription only (shows animation, no tab-switch) ──
    // Accepts an optional config from the Re-generate menu so the user can
    // override the server + model for this single pass. Called with `null`
    // by the menu's "Use Defaults" button.
    const handleReRunTranscription = useCallback(
        async (config?: GenerateConfig | null) => {
            setShowReTranscribeOptions(false);
            setPipelineStage("transcribing");
            setPipelineError(null);
            try {
                const body: Record<string, unknown> = {};
                if (config?.transcriptionProviderId) {
                    body.providerId = config.transcriptionProviderId;
                }
                if (config?.transcriptionModel) {
                    body.model = config.transcriptionModel;
                }
                const res = await fetch(
                    `/api/recordings/${recording.id}/transcribe`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    },
                );
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}));
                    throw new Error(
                        e.error || `Transcription failed (${res.status})`,
                    );
                }
                setPipelineStage("complete");
                toast.success("Re-generation complete!");
                onGenerated?.();
                setTimeout(() => setPipelineStage("idle"), 1800);
            } catch (err) {
                setPipelineStage("error");
                const msg =
                    err instanceof Error ? err.message : "Transcription failed";
                setPipelineError(msg);
                toast.error(msg);
                setTimeout(() => setPipelineStage("idle"), 5000);
            }
        },
        [recording.id, onGenerated],
    );

    // ── Re-generate summary only (shows animation) ──────────────────
    // Accepts an optional config so the user can override server, model,
    // template and output language for this pass. `null` = use defaults.
    const handleReGenerateSummary = useCallback(
        async (config?: GenerateConfig | null) => {
            setShowReSummarizeOptions(false);
            setPipelineStage("summarizing");
            setPipelineError(null);
            try {
                const body: Record<string, unknown> = {
                    preset: config?.summaryPreset || summaryPreset || "general",
                };
                if (config?.summaryProviderId) {
                    body.providerId = config.summaryProviderId;
                }
                if (config?.summaryModel) {
                    body.model = config.summaryModel;
                }
                if (config?.language && config.language !== "auto") {
                    body.language = config.language;
                }
                const res = await fetch(
                    `/api/recordings/${recording.id}/summary`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    },
                );
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}));
                    throw new Error(
                        e.error || `Summary failed (${res.status})`,
                    );
                }
                setPipelineStage("complete");
                toast.success("Summary regenerated!");
                onGenerated?.();
                setTimeout(() => {
                    setPipelineStage("idle");
                    // GET the freshly saved summary into the hook's state (the
                    // POST above already created it — don't POST again).
                    refetchSummary();
                }, 1800);
            } catch (err) {
                setPipelineStage("error");
                const msg =
                    err instanceof Error ? err.message : "Summary failed";
                setPipelineError(msg);
                toast.error(msg);
                setTimeout(() => setPipelineStage("idle"), 5000);
            }
        },
        [recording.id, summaryPreset, refetchSummary, onGenerated],
    );

    const wordCount = transcription?.text?.trim()
        ? transcription.text.trim().split(/\s+/).length
        : 0;

    // ── Is the pipeline running? Show the pipeline view ──────────
    if (
        isGenerating ||
        pipelineStage === "complete" ||
        pipelineStage === "error"
    ) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <GeneratePipeline
                        stage={pipelineStage}
                        error={pipelineError}
                    />
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-3">
            {/* ── Transcription ─────────────────────────────────── */}
            {showTranscript && (
                <Card>
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
                                    <>
                                        <ExportMenu
                                            recordingTitle={
                                                recording.filename ??
                                                "Recording"
                                            }
                                            transcriptionText={
                                                transcription.text
                                            }
                                            summaryData={summaryData}
                                        />
                                        <Button
                                            onClick={() =>
                                                setShowReTranscribeOptions(
                                                    (v) => !v,
                                                )
                                            }
                                            size="sm"
                                            variant="ghost"
                                            disabled={
                                                isGenerating || isTranscribing
                                            }
                                            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            <RefreshCw className="size-3" />
                                            Re-generate
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {/* Re-generate transcription options menu */}
                        {showReTranscribeOptions && transcription?.text && (
                            <div className="mb-4">
                                <GenerateOptionsMenu
                                    open={showReTranscribeOptions}
                                    mode="transcription"
                                    onClose={() =>
                                        setShowReTranscribeOptions(false)
                                    }
                                    onGenerate={handleReRunTranscription}
                                    onAutoGenerate={() =>
                                        handleReRunTranscription(null)
                                    }
                                    isGenerating={isGenerating}
                                />
                            </div>
                        )}
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
                                        <span className="font-mono">
                                            {transcription.language}
                                        </span>
                                        <span className="opacity-40 mx-1">
                                            ·
                                        </span>
                                        <span>
                                            {transcription.text.length.toLocaleString()}{" "}
                                            chars
                                        </span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-4 py-10">
                                <GenerateButton
                                    onClick={() => setShowOptions(true)}
                                    disabled={isGenerating}
                                />
                                <GenerateOptionsMenu
                                    open={showOptions}
                                    onClose={() => setShowOptions(false)}
                                    onGenerate={handleConfiguredGenerate}
                                    onAutoGenerate={handleAutoGenerate}
                                    isGenerating={isGenerating}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

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
                                {summaryData?.summary && (
                                    <ExportMenu
                                        recordingTitle={
                                            recording.filename ?? "Recording"
                                        }
                                        transcriptionText={transcription.text}
                                        summaryData={summaryData}
                                    />
                                )}
                                {!isSummarizing && (
                                    <Select
                                        value={summaryPreset}
                                        onValueChange={setSummaryPreset}
                                    >
                                        <SelectTrigger className="h-7 w-[140px] text-xs">
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
                                )}
                                <Button
                                    onClick={() =>
                                        setShowReSummarizeOptions((v) => !v)
                                    }
                                    size="sm"
                                    variant={summaryData ? "ghost" : "default"}
                                    disabled={isSummarizing || isGenerating}
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
                        {/* Re-generate summary options menu */}
                        {showReSummarizeOptions && (
                            <div className="mb-4">
                                <GenerateOptionsMenu
                                    open={showReSummarizeOptions}
                                    mode="summary"
                                    initialSummaryPreset={summaryPreset}
                                    onClose={() =>
                                        setShowReSummarizeOptions(false)
                                    }
                                    onGenerate={handleReGenerateSummary}
                                    onAutoGenerate={() =>
                                        handleReGenerateSummary(null)
                                    }
                                    isGenerating={isGenerating}
                                />
                            </div>
                        )}
                        {isSummarizing ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-10">
                                <Loader2 className="size-6 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                    Generating summary…
                                </p>
                            </div>
                        ) : summaryData?.summary ? (
                            <div className="space-y-3">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSummaryExpanded(!summaryExpanded)
                                    }
                                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {summaryExpanded ? (
                                        <ChevronUp className="size-3.5" />
                                    ) : (
                                        <ChevronDown className="size-3.5" />
                                    )}
                                    {summaryExpanded
                                        ? "Collapse"
                                        : "Expand summary"}
                                </button>

                                {summaryExpanded && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <div className="rounded-lg bg-muted/60 border border-border/50 p-4 dark:bg-muted/30">
                                            <p className="text-sm leading-relaxed text-foreground/90">
                                                {summaryData.summary}
                                            </p>
                                        </div>

                                        {summaryData.keyPoints &&
                                            summaryData.keyPoints.length >
                                                0 && (
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">
                                                        Key Points
                                                    </h4>
                                                    <ul className="space-y-1.5">
                                                        {summaryData.keyPoints.map(
                                                            (point) => (
                                                                <li
                                                                    key={`kp-${point.slice(0, 32)}`}
                                                                    className="flex items-start gap-2.5 text-sm text-foreground/80"
                                                                >
                                                                    <span className="mt-2 size-1.5 rounded-full bg-primary shrink-0" />
                                                                    {point}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {summaryData.actionItems &&
                                            summaryData.actionItems.length >
                                                0 && (
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">
                                                        Action Items
                                                    </h4>
                                                    <ul className="space-y-1.5">
                                                        {summaryData.actionItems.map(
                                                            (item) => (
                                                                <li
                                                                    key={`ai-${item.slice(0, 32)}`}
                                                                    className="flex items-start gap-2.5 text-sm text-foreground/80"
                                                                >
                                                                    <ListChecks className="size-3.5 mt-0.5 text-primary shrink-0" />
                                                                    {item}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                        {/* Memory Map */}
                                        {summaryData.summary && (
                                            <MemoryMap
                                                title={
                                                    recording.filename ??
                                                    "Recording"
                                                }
                                                summary={summaryData.summary}
                                                keyPoints={
                                                    summaryData.keyPoints
                                                }
                                                actionItems={
                                                    summaryData.actionItems
                                                }
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

            {/* Notes tab with nothing generated yet — offer the Generate flow
                instead of leaving the pane blank. */}
            {showSummary && !transcription?.text && (
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-col items-center justify-center gap-4 py-10">
                            <p className="text-sm text-muted-foreground text-center max-w-xs">
                                Nothing here yet. Generate a transcription and
                                summary to see your notes and memory map.
                            </p>
                            <GenerateButton
                                onClick={() => setShowOptions(true)}
                                disabled={isGenerating}
                            />
                            <GenerateOptionsMenu
                                open={showOptions}
                                onClose={() => setShowOptions(false)}
                                onGenerate={handleConfiguredGenerate}
                                onAutoGenerate={handleAutoGenerate}
                                isGenerating={isGenerating}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
