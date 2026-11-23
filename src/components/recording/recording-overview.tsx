"use client";

import Link from "next/link";
import { providerDisplayName } from "@/components/recording/format";
import {
    type TranscribeOptions,
    TranscribePrompt,
} from "@/components/recording/recording-transcript";
import type { SummaryProviderState } from "@/components/recording/types";
import { RichMarkdown } from "@/components/recordings/rich-content";
import { Button } from "@/components/ui/button";
import { StatusLine } from "@/components/ui/status-dot";
import type {
    SummaryData,
    SummaryError,
    SummaryLoadStatus,
} from "@/hooks/use-transcription-summary";

interface Props {
    hasTranscript: boolean;
    summary: SummaryData | null;
    /** Where loading the stored summary stands. */
    loadStatus: SummaryLoadStatus;
    /**
     * The recording's summary flag. While loading, only a recording
     * that has a summary gets the skeleton; others show their next step.
     */
    expectSummary: boolean;
    onRetryLoad: () => void;
    isSummarizing: boolean;
    error: SummaryError | null;
    providerState: SummaryProviderState;
    onSummarize: () => void;
    /** How to transcribe, for a recording without a transcript yet. */
    transcribe: TranscribeOptions;
}

/**
 * Overview tab: the summary at reading size, then key points and action
 * items as numbered lists. Without a summary it shows the one next step
 * (transcribe, summarize, set up a provider, or retry a failure). While
 * the stored summary loads, a skeleton holds its place.
 */
export function RecordingOverviewTab({
    hasTranscript,
    summary,
    loadStatus,
    expectSummary,
    onRetryLoad,
    isSummarizing,
    error,
    providerState,
    onSummarize,
    transcribe,
}: Props) {
    if (isSummarizing) {
        return (
            <StatusLine tone="working" className="text-ui text-subtle">
                Summarizing…
            </StatusLine>
        );
    }

    if (summary?.summary) {
        const facts = [
            summary.provider ? providerDisplayName(summary.provider) : null,
            summary.model,
        ].filter(Boolean);
        return (
            <div className="flex flex-col gap-3.5">
                <RichMarkdown
                    content={summary.summary}
                    className="text-transcript text-foreground sm:text-lead"
                />
                <SummaryList title="Key points" items={summary.keyPoints} />
                <SummaryList title="Action items" items={summary.actionItems} />
                {facts.length > 0 ? (
                    <p className="pt-3.5 text-small text-muted-foreground">
                        Summarized with {facts.join(" · ")}
                    </p>
                ) : null}
            </div>
        );
    }

    if (!hasTranscript) {
        return (
            <TranscribePrompt
                message="Transcribe this recording to get a summary"
                {...transcribe}
            />
        );
    }

    if (!error && loadStatus === "loading" && expectSummary) {
        return <SummarySkeleton />;
    }

    if (!error && loadStatus === "failed") {
        return (
            <div className="flex flex-col items-start gap-4">
                <p className="text-transcript text-subtle">
                    Couldn't load the summary
                </p>
                <Button variant="quiet" size="compact" onClick={onRetryLoad}>
                    Retry
                </Button>
            </div>
        );
    }

    const missingProvider =
        error?.code === "AI_PROVIDER_NOT_CONFIGURED" ||
        (!error && providerState === "missing");
    if (missingProvider) {
        return (
            <div className="flex flex-col items-start gap-4">
                <p className="text-transcript text-subtle">
                    Summaries need an AI provider. Add one in Settings under AI
                    for summaries.
                </p>
                <Button variant="quiet" size="compact" asChild>
                    <Link href="/settings#ai">Open AI for summaries</Link>
                </Button>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-start gap-4">
                <p className="text-transcript text-subtle">
                    Couldn't summarize this recording. {error.message}
                </p>
                <Button variant="quiet" size="compact" onClick={onSummarize}>
                    Try again
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-start gap-4">
            <p className="text-transcript text-subtle">No summary yet</p>
            <Button variant="quiet" size="compact" onClick={onSummarize}>
                Summarize
            </Button>
        </div>
    );
}

const SKELETON_LINES = ["w-full", "w-full", "w-11/12", "w-3/5"] as const;
const SKELETON_ITEMS = ["w-4/5", "w-2/3"] as const;
const SKELETON_BAR =
    "h-3 animate-pulse rounded-full bg-accent motion-reduce:animate-none";

/**
 * Placeholder in the shape of a loaded summary (a paragraph, then a
 * list), so the summary takes its space without pushing anything.
 */
function SummarySkeleton() {
    return (
        <output aria-label="Loading summary" className="flex flex-col gap-3.5">
            <div className="text-transcript sm:text-lead">
                {SKELETON_LINES.map((width, i) => (
                    <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines
                        key={i}
                        className="flex h-[1lh] items-center"
                    >
                        <div className={`${SKELETON_BAR} ${width}`} />
                    </div>
                ))}
            </div>
            <div className="flex flex-col pt-3.5">
                <div className="flex h-4.75 items-center mb-1.5">
                    <div className={`${SKELETON_BAR} w-20`} />
                </div>
                {SKELETON_ITEMS.map((width) => (
                    <div
                        key={width}
                        className="flex h-6 box-content items-center border-t border-border py-3.5 sm:py-4.5"
                    >
                        <div className={`${SKELETON_BAR} ${width}`} />
                    </div>
                ))}
            </div>
        </output>
    );
}

function SummaryList({
    title,
    items,
}: {
    title: string;
    items: string[] | null;
}) {
    if (!items || items.length === 0) return null;
    return (
        <section className="flex flex-col pt-3.5">
            <h2 className="pb-1.5 text-small font-medium text-muted-foreground">
                {title}
            </h2>
            <ol>
                {items.map((item, i) => (
                    <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: items come from one summary and are never reordered
                        key={i}
                        className="flex gap-3.5 border-t border-border py-3.5 sm:gap-5 sm:py-4.5"
                    >
                        <span
                            aria-hidden="true"
                            className="w-6.5 shrink-0 text-base font-medium tabular-nums text-strong sm:w-7"
                        >
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 text-base text-strong">
                            {item}
                        </span>
                    </li>
                ))}
            </ol>
        </section>
    );
}
