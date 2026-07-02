import { cn } from "@/lib/utils";

export function MetricCard({
    label,
    value,
    sub,
    accent,
    delta,
}: {
    label: string;
    value: string | number;
    sub?: string;
    accent?: "danger" | "warning";
    /**
     * Optional week-over-week delta. `current` and `prior` are raw counts
     * (not formatted strings). `healthyDirection` decides the color: "up"
     * for things we want to grow (signups, activations), "down" for things
     * that cost us money (bytes, server-tx, audio minutes). Within ±5% of
     * prior we render neutral grey to avoid noise.
     */
    delta?: {
        current: number;
        prior: number;
        healthyDirection: "up" | "down";
        /** Optional formatter for the absolute delta (e.g. formatBytes). */
        format?: (n: number) => string;
        /**
         * Suppress the trailing "(+X% WoW)" suffix. Use when the metric is
         * itself a rate (coverage %, etc.) where a percent-change-of-percent
         * is more confusing than informative.
         */
        suppressPercent?: boolean;
    };
}) {
    return (
        <div className="border rounded-xl p-4 bg-card">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "text-2xl font-semibold mt-1",
                    accent === "danger" && "text-red-600",
                    accent === "warning" && "text-amber-600",
                )}
            >
                {value}
            </div>
            {delta ? <DeltaLine {...delta} /> : null}
            {sub ? (
                <div className="text-xs text-muted-foreground mt-1">{sub}</div>
            ) : null}
        </div>
    );
}

function DeltaLine({
    current,
    prior,
    healthyDirection,
    format,
    suppressPercent,
}: {
    current: number;
    prior: number;
    healthyDirection: "up" | "down";
    format?: (n: number) => string;
    suppressPercent?: boolean;
}) {
    const diff = current - prior;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    const absDiff = Math.abs(diff);
    const fmt = format ?? formatNumber;
    const absStr = fmt(absDiff);

    // Percent: undefined when prior is 0 (avoid ∞ / divide-by-zero noise).
    const pct = prior > 0 ? (diff / prior) * 100 : undefined;

    // Color rule: within ±5% → neutral. Otherwise direction vs healthy.
    // For rate-type metrics (suppressPercent), use absolute diff threshold
    // instead -- a 0 → 1 change in count would otherwise read as "∞%".
    let tone: "neutral" | "good" | "bad" = "neutral";
    const significant = suppressPercent
        ? absDiff > 0
        : pct !== undefined && Math.abs(pct) > 5;
    if (significant) {
        const movingUp = diff > 0;
        const isHealthy =
            (movingUp && healthyDirection === "up") ||
            (!movingUp && healthyDirection === "down");
        tone = isHealthy ? "good" : "bad";
    }

    const suffix = suppressPercent
        ? " WoW"
        : pct === undefined
          ? " (vs 0 prior)"
          : ` (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}% WoW)`;

    return (
        <div
            className={cn(
                "text-xs mt-1",
                tone === "neutral" && "text-muted-foreground",
                tone === "good" && "text-emerald-600",
                tone === "bad" && "text-amber-600",
            )}
        >
            {sign}
            {absStr}
            {suffix}
        </div>
    );
}

export function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
    return NUMBER_FORMAT.format(n);
}

export function formatHours(ms: number): string {
    if (!ms || ms < 0) return "0h";
    const hours = ms / 3_600_000;
    if (hours < 1) {
        const minutes = Math.round(ms / 60_000);
        // Edge case: 59m31s+ rounds to 60min -- roll over to 1.0h instead
        // of rendering the nonsensical "60m".
        if (minutes >= 60) return "1.0h";
        return `${minutes}m`;
    }
    if (hours < 100) return `${hours.toFixed(1)}h`;
    return `${Math.round(hours).toLocaleString("en-US")}h`;
}

export function formatDate(d: Date | null | undefined): string {
    if (!d) return "—";
    return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatRelative(d: Date | null | undefined): string {
    if (!d) return "never";
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    return `${mo}mo ago`;
}
