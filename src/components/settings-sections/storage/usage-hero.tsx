"use client";

import { useId } from "react";
import { formatBytes } from "@/lib/format-bytes";
import { uiText } from "@/lib/i18n";
import { formatUiHoursCompact as formatHoursCompact } from "@/lib/i18n/format";

interface UsageHeroProps {
    usedBytes: number;
    recordingCount: number;
    totalDurationMs: number;
    /** Free space on the host disk. Only set for self-host + local. */
    diskFreeBytes: number | null;
    /**
     * Reserved seam for per-account quotas. Always null today. When set,
     * takes precedence over `diskFreeBytes` so the ring reflects the
     * account-level cap rather than the host's filesystem capacity.
     */
    quotaBytes: number | null;
}

/**
 * Top-of-section usage summary.
 *
 * Two layouts driven by data, not props:
 * - With a meaningful denominator (local disk free, or a future
 *   account quota) we render a radial progress ring wrapping the big
 *   "Used" number. The ring merges the absolute and relative answers
 *   into one focal element — no separate progress bar needed.
 * - Without a denominator (S3, hosted-with-no-quota), the ring is
 *   omitted; just number + sub-line. Drawing a fake/empty ring would
 *   imply a limit that doesn't exist.
 *
 * Mode differences (hosted vs self-host) are decided server-side by
 * what's populated; no copy here hints at plans, tiers, or upgrades.
 */
export function UsageHero({
    usedBytes,
    recordingCount,
    totalDurationMs,
    diskFreeBytes,
    quotaBytes,
}: UsageHeroProps) {
    const avgBytes =
        recordingCount > 0 ? Math.round(usedBytes / recordingCount) : 0;

    let capacity: {
        used: number;
        total: number;
        remainingLabel: string;
    } | null = null;
    if (typeof quotaBytes === "number" && quotaBytes > 0) {
        capacity = {
            used: usedBytes,
            total: quotaBytes,
            remainingLabel: uiText("{size} remaining", {
                size: formatBytes(Math.max(0, quotaBytes - usedBytes)),
            }),
        };
    } else if (typeof diskFreeBytes === "number" && diskFreeBytes >= 0) {
        capacity = {
            used: usedBytes,
            total: usedBytes + diskFreeBytes,
            remainingLabel: uiText("{size} free on disk", {
                size: formatBytes(diskFreeBytes),
            }),
        };
    }

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-5">
                {capacity ? (
                    <CapacityRing
                        used={capacity.used}
                        total={capacity.total}
                        usedBytes={usedBytes}
                    />
                ) : (
                    <div className="text-4xl font-semibold tabular-nums">
                        {formatBytes(usedBytes)}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {uiText("Storage used")}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                        {recordingCount.toLocaleString()}{" "}
                        {recordingCount === 1
                            ? uiText("recording")
                            : uiText("recordings")}
                        {totalDurationMs > 0 && (
                            <>
                                {" · "}
                                {formatHoursCompact(totalDurationMs)}{" "}
                                {uiText("total")}
                            </>
                        )}
                        {avgBytes > 0 && (
                            <>
                                {" · "}
                                {formatBytes(avgBytes)} {uiText("avg")}
                            </>
                        )}
                    </div>
                    {capacity && (
                        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                            {capacity.remainingLabel}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

interface CapacityRingProps {
    used: number;
    total: number;
    /**
     * Pre-computed because the parent already needs `usedBytes` for
     * other captions; passing it down avoids re-formatting and keeps
     * the ring's center label in sync with the hero's main number.
     */
    usedBytes: number;
}

/**
 * Inline-SVG radial progress ring. The big used-bytes value sits in
 * the middle; the ring sweep shows how much of `total` is consumed.
 *
 * Geometry note: we draw a single circle with a dasharray covering
 * the full circumference, then offset by `(1 - pct) * circumference`
 * to expose the filled arc. Starting at 12 o'clock (rotate -90deg)
 * matches the convention users expect from capacity meters.
 */
function CapacityRing({ used, total, usedBytes }: CapacityRingProps) {
    const id = useId();
    const pct = Math.min(1, Math.max(0, total > 0 ? used / total : 0));
    const size = 132;
    const stroke = 10;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - pct);
    const pctLabel = `${Math.round(pct * 100)}%`;

    return (
        <div
            className="relative shrink-0"
            style={{ width: size, height: size }}
        >
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                role="img"
                aria-labelledby={`${id}-title`}
            >
                <title id={`${id}-title`}>
                    {uiText("Storage capacity:")}
                    {pctLabel} {uiText("used")}
                </title>
                {/* Track */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    className="stroke-muted"
                />
                {/* Filled arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    className="stroke-primary transition-[stroke-dashoffset] duration-500"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-xl font-semibold tabular-nums leading-tight">
                    {formatBytes(usedBytes)}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                    {pctLabel} {uiText("used")}
                </div>
            </div>
        </div>
    );
}
