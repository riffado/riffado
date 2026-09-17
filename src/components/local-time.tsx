"use client";

import { useEffect, useState } from "react";
import { formatRecordingDateTimeRange } from "@/lib/format-date";

interface Props {
    /** Date object or anything `new Date(...)` accepts (ISO string, ms). */
    value: Date | string | number;
    /**
     * Variant: \`datetime\` -> toLocaleString(); \`date\` -> toLocaleDateString().
     * Defaults to \`datetime\` which mirrors the prior `new Date(x).toLocaleString()`
     * call sites.
     */
    variant?: "datetime" | "date";
    className?: string;
}

/**
 * Renders a timestamp using the user's locale, but only after the
 * client takes over. SSR emits a stable, locale-neutral ISO form so
 * the server and the first client render produce identical HTML --
 * otherwise hydration mismatches surface as a visible flash plus a
 * console warning (and, on strict React modes, a re-mount).
 *
 * Why not just `<time suppressHydrationWarning>`? Because we'd still
 * have to pay the SSR -> CSR text swap; this is the same swap done
 * deliberately and visibly only after we know the client locale.
 */
export function LocalTime({ value, variant = "datetime", className }: Props) {
    const date = value instanceof Date ? value : new Date(value);
    const iso = date.toISOString();
    const [text, setText] = useState<string>(iso);

    useEffect(() => {
        setText(
            variant === "date"
                ? date.toLocaleDateString()
                : date.toLocaleString(),
        );
    }, [date, variant]);

    return (
        <time dateTime={iso} className={className}>
            {text}
        </time>
    );
}

interface LocalTimeRangeProps {
    start: Date | string | number;
    durationMs: number;
    className?: string;
}

/** Render a recording's absolute local date and start–end time. */
export function LocalTimeRange({
    start,
    durationMs,
    className,
}: LocalTimeRangeProps) {
    const startMs =
        start instanceof Date ? start.getTime() : new Date(start).getTime();
    const startDate = new Date(startMs);
    const endDate = new Date(startDate.getTime() + durationMs);
    const [text, setText] = useState(
        `${startDate.toISOString()}–${endDate.toISOString()}`,
    );

    useEffect(() => {
        setText(formatRecordingDateTimeRange(new Date(startMs), durationMs));
    }, [startMs, durationMs]);

    return (
        <time dateTime={startDate.toISOString()} className={className}>
            {text}
        </time>
    );
}
