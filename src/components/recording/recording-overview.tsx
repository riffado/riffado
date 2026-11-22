"use client";

import Link from "next/link";
import type { SummaryProviderState } from "@/components/recording/types";
import { RichMarkdown } from "@/components/recordings/rich-content";
import { Button } from "@/components/ui/button";
import { StatusLine } from "@/components/ui/status-dot";
import type {
    SummaryData,
    SummaryError,
} from "@/hooks/use-transcription-summary";

interface Props {
    hasTranscript: boolean;
    summary: SummaryData | null;
    isSummarizing: boolean;
    error: SummaryError | null;
    providerState: SummaryProviderState;
    onSummarize: () => void;
}

/**
 * Overview tab: the summary at reading size, then key points and action
 * items as numbered lists. Without a summary it shows the one next step
 * (summarize, set up a provider, or retry a failure).
 */
export function RecordingOverviewTab({
    hasTranscript,
    summary,
    isSummarizing,
    error,
    providerState,
    onSummarize,
}: Props) {
    if (isSummarizing) {
        return (
            <StatusLine tone="working" className="text-ui text-subtle">
                Summarizing…
            </StatusLine>
        );
    }

    if (summary?.summary) {
        const facts = [summary.provider, summary.model].filter(Boolean);
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
            <p className="text-transcript text-subtle">
                Transcribe this recording to get a summary.
            </p>
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
            <p className="text-transcript text-subtle">No summary yet.</p>
            <Button variant="quiet" size="compact" onClick={onSummarize}>
                Summarize
            </Button>
        </div>
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
                            className="font-dot w-6.5 shrink-0 text-lg leading-6 font-black text-strong sm:w-7 sm:text-xl"
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
