"use client";

import { formatBytes } from "@/lib/format-bytes";
import { uiText } from "@/lib/i18n";

/**
 * Shared color stops between the breakdown bar and the largest list.
 * Five named slots + a muted "rest" track. Sourced from the existing
 * --chart-N CSS vars in globals.css so light/dark mode are covered.
 */
export const BREAKDOWN_COLORS = [
    "bg-chart-1",
    "bg-chart-2",
    "bg-chart-3",
    "bg-chart-4",
    "bg-chart-5",
] as const;
export const REST_COLOR = "bg-muted-foreground/30";

interface BreakdownBarProps {
    /** Sizes of the named top-N segments, in bytes, descending. */
    segments: { id: string; bytes: number }[];
    /** Total storage used (denominator for the bar). */
    totalBytes: number;
}

/**
 * Horizontal stacked bar showing the concentration of storage usage:
 * the top-N largest recordings as named segments and "Everything else"
 * as the remainder.
 *
 * Why this exists alongside the largest-recordings list:
 *   The list answers "which files?". The bar answers "how
 *   concentrated?" — i.e. would deleting the top file move the
 *   needle, or is storage spread thin across many recordings? That's
 *   a real piece of information the list alone cannot communicate.
 *
 * Reading note: a horizontal stacked bar is easier to compare than a
 * donut (linear extent vs. arc length). Same data, less guesswork.
 */
export function BreakdownBar({ segments, totalBytes }: BreakdownBarProps) {
    if (totalBytes <= 0 || segments.length === 0) return null;

    const topBytes = segments.reduce((sum, s) => sum + s.bytes, 0);
    const restBytes = Math.max(0, totalBytes - topBytes);
    const topPct = Math.min(100, (topBytes / totalBytes) * 100);

    // Pre-compute pixel widths as percentages so segments add up
    // exactly to 100 without rounding gaps at the right edge.
    const widths = segments.map((s) => (s.bytes / totalBytes) * 100);
    const restWidth = (restBytes / totalBytes) * 100;

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-medium">
                    {uiText("Storage breakdown")}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                    {uiText("Top")}
                    {segments.length} ={" "}
                    <span className="font-medium text-foreground">
                        {topPct.toFixed(0)}%
                    </span>{" "}
                    {uiText("of")}
                    {formatBytes(totalBytes)}
                </div>
            </div>
            <div
                className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={uiText(
                    "Top {count} recordings account for {percent} percent of storage",
                    { count: segments.length, percent: topPct.toFixed(0) },
                )}
            >
                {segments.map((s, i) => (
                    <div
                        key={s.id}
                        className={`${BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} h-full`}
                        style={{ width: `${widths[i]}%` }}
                        title={`${formatBytes(s.bytes)} (${((s.bytes / totalBytes) * 100).toFixed(1)}%)`}
                    />
                ))}
                {restBytes > 0 && (
                    <div
                        className={`${REST_COLOR} h-full`}
                        style={{ width: `${restWidth}%` }}
                        title={uiText("Everything else: {size}", {
                            size: formatBytes(restBytes),
                        })}
                    />
                )}
            </div>
        </div>
    );
}
