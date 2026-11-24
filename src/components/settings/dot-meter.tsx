import type * as React from "react";
import { cn } from "@/lib/utils";

const DOTS = 60;

/**
 * Dot progress bar from the design system's dot-matrix language: 60 round
 * dots, filled ink up to `fraction`, the rest in the border colour. On
 * narrow screens every other dot is hidden so the proportion holds. The
 * `warning` tone fills in the working-LED colour (near a limit).
 */
export function DotMeter({
    fraction,
    tone = "default",
    label,
    className,
}: {
    /** Used share in [0, 1]. Values outside are clamped. */
    fraction: number;
    tone?: "default" | "warning";
    /** Accessible description, e.g. "18 of 50 GB used". */
    label: string;
    className?: string;
}) {
    const clamped = Math.min(1, Math.max(0, fraction));
    const filled = Math.round(clamped * DOTS);
    return (
        <div
            role="img"
            aria-label={label}
            className={cn(
                "flex justify-between max-sm:[&>*:nth-child(even)]:hidden",
                className,
            )}
        >
            {Array.from({ length: DOTS }, (_, i) => (
                <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, positional dots
                    key={i}
                    aria-hidden="true"
                    className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        i < filled
                            ? tone === "warning"
                                ? "bg-status-working"
                                : "bg-strong"
                            : "bg-border",
                    )}
                />
            ))}
        </div>
    );
}

/** A live number in Doto with round dots (DESIGN.md: numbers that are alive). */
export function DotNumber({
    children,
    size = "default",
}: {
    children: React.ReactNode;
    size?: "default" | "large";
}) {
    return (
        <span
            className={cn(
                "font-dot font-black text-strong",
                size === "large" ? "text-meter-large" : "text-meter",
            )}
        >
            {children}
        </span>
    );
}

/**
 * One usage readout: label on the left, Doto value on the right, the dot
 * meter, and a footnote line.
 */
export function UsageReadout({
    label,
    value,
    fraction,
    meterLabel,
    tone,
    footer,
}: {
    label: React.ReactNode;
    /** Usually `DotNumber`s interleaved with unit text. */
    value: React.ReactNode;
    /** Used share in [0, 1], or null when there is no limit to measure. */
    fraction: number | null;
    meterLabel: string;
    tone?: "default" | "warning";
    footer?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-3.5 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-row font-semibold text-strong">
                    {label}
                </span>
                <span className="flex items-baseline gap-1.5 text-ui text-subtle tabular-nums">
                    {value}
                </span>
            </div>
            {fraction !== null && (
                <DotMeter fraction={fraction} tone={tone} label={meterLabel} />
            )}
            {footer && (
                <p className="text-small leading-4 text-subtle tabular-nums">
                    {footer}
                </p>
            )}
        </div>
    );
}
