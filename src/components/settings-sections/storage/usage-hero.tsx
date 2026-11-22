"use client";

import { DotMeter, DotNumber } from "@/components/settings/dot-meter";
import { shortBytes, splitBytes } from "@/components/settings/format-usage";
import { SettingsCard } from "@/components/settings/settings-card";
import { formatHoursCompact } from "@/lib/format-duration";

interface UsageHeroProps {
    usedBytes: number;
    recordingCount: number;
    totalDurationMs: number;
    /** Free space on the host disk. Only set for self-host + local. */
    diskFreeBytes: number | null;
    /**
     * Reserved seam for per-account quotas. Always null today. When set,
     * takes precedence over `diskFreeBytes` so the meter reflects the
     * account-level cap rather than the host's filesystem capacity.
     */
    quotaBytes: number | null;
    /** Footnote line, e.g. where the files are kept. */
    footnote?: string | null;
}

/**
 * Storage usage readout: the used amount as a Doto number, the recording
 * count, and a dot meter when there is a meaningful limit (local disk
 * free space, or a future account quota). Without one (S3, hosted with no
 * quota) the meter is left out rather than implying a limit that doesn't
 * exist.
 */
export function UsageHero({
    usedBytes,
    recordingCount,
    totalDurationMs,
    diskFreeBytes,
    quotaBytes,
    footnote,
}: UsageHeroProps) {
    const avgBytes =
        recordingCount > 0 ? Math.round(usedBytes / recordingCount) : 0;

    let capacity: { total: number; remainingLabel: string } | null = null;
    if (typeof quotaBytes === "number" && quotaBytes > 0) {
        capacity = {
            total: quotaBytes,
            remainingLabel: `${shortBytes(Math.max(0, quotaBytes - usedBytes))} left`,
        };
    } else if (typeof diskFreeBytes === "number" && diskFreeBytes >= 0) {
        capacity = {
            total: usedBytes + diskFreeBytes,
            remainingLabel: `${shortBytes(diskFreeBytes)} free on disk`,
        };
    }

    const used = splitBytes(usedBytes);
    const fraction = capacity ? usedBytes / capacity.total : 0;
    const details = [
        capacity?.remainingLabel,
        totalDurationMs >= 60_000
            ? `${formatHoursCompact(totalDurationMs)} of audio`
            : null,
        avgBytes > 0
            ? `${shortBytes(avgBytes)} per recording on average`
            : null,
    ].filter(Boolean);

    return (
        <SettingsCard tone="quiet" className="gap-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex items-baseline gap-2 text-ui text-subtle tabular-nums">
                    <DotNumber size="large">{used.value}</DotNumber>
                    <span>
                        {used.unit} used
                        {capacity ? ` of ${shortBytes(capacity.total)}` : ""}
                    </span>
                </div>
                <span className="text-ui text-subtle tabular-nums">
                    {recordingCount.toLocaleString()}{" "}
                    {recordingCount === 1 ? "recording" : "recordings"}
                </span>
            </div>
            {capacity && (
                <DotMeter
                    fraction={fraction}
                    label={`${shortBytes(usedBytes)} of ${shortBytes(capacity.total)} used`}
                />
            )}
            {details.length > 0 && (
                <p className="text-small leading-4 text-subtle tabular-nums">
                    {details.join(" · ")}
                </p>
            )}
            {footnote && (
                <p className="text-small leading-4 text-subtle">{footnote}</p>
            )}
        </SettingsCard>
    );
}
