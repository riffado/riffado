"use client";

import Link from "next/link";
import { BREAKDOWN_COLORS } from "@/components/settings-sections/storage/breakdown-bar";
import { formatBytes } from "@/lib/format-bytes";
import { formatDurationMs } from "@/lib/format-duration";
import { uiText } from "@/lib/i18n";

interface LargestRecordingsProps {
    items: {
        id: string;
        filename: string;
        filesize: number;
        duration: number;
        startTime: string | Date;
    }[];
}

/**
 * Top-N (server limits to 5) largest active recordings. Each row
 * leads with a color swatch matching its segment in
 * <BreakdownBar /> so the two visualizations read as one conversation
 * (segment width → row size). Linking to the recording detail keeps
 * cleanup small and reversible (preview before delete).
 */
export function LargestRecordings({ items }: LargestRecordingsProps) {
    if (items.length === 0) return null;

    return (
        <div className="rounded-lg border bg-card">
            <div className="px-4 pt-3 pb-2">
                <div className="text-sm font-medium">
                    {uiText("Largest recordings")}
                </div>
                <div className="text-xs text-muted-foreground">
                    {uiText("Open a recording to preview it before deleting")}
                </div>
            </div>
            <ul className="divide-y">
                {items.map((r, i) => (
                    <li key={r.id}>
                        <Link
                            href={`/recordings/${r.id}`}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors text-sm"
                        >
                            <span
                                className={`size-2.5 shrink-0 rounded-sm ${BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]}`}
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {r.filename}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {formatDurationMs(r.duration)}
                            </span>
                            <span className="shrink-0 text-xs font-medium tabular-nums w-20 text-right">
                                {formatBytes(r.filesize)}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
