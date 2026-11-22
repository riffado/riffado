"use client";

import Link from "next/link";
import { BREAKDOWN_COLORS } from "@/components/settings-sections/storage/breakdown-bar";
import { formatBytes } from "@/lib/format-bytes";
import { formatDurationMs } from "@/lib/format-duration";

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
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
                <h3 className="text-row font-semibold text-strong">
                    Largest recordings
                </h3>
                <p className="text-ui text-subtle">
                    Open one to listen before you delete it
                </p>
            </div>
            <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                {items.map((r, i) => (
                    <li key={r.id}>
                        <Link
                            href={`/recordings/${r.id}`}
                            className="flex items-center gap-3 py-3 text-ui outline-none transition-colors hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            <span
                                className={`size-2.5 shrink-0 rounded-sm ${BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]}`}
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate font-medium text-strong">
                                {r.filename}
                            </span>
                            <span className="shrink-0 text-small text-subtle tabular-nums">
                                {formatDurationMs(r.duration)}
                            </span>
                            <span className="w-20 shrink-0 text-right text-small font-medium text-strong tabular-nums">
                                {formatBytes(r.filesize)}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
