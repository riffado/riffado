import type * as React from "react";
import { cn } from "@/lib/utils";

/** Where a recording or connection stands. Maps to the LED palette. */
export type StatusTone = "ready" | "working" | "attention" | "idle";

const toneClass: Record<StatusTone, string> = {
    ready: "bg-status-ready",
    working: "bg-status-working",
    attention: "bg-terracotta",
    idle: "border-[1.5px] border-muted-foreground bg-transparent",
};

const sizeClass = {
    default: "size-[7px]",
    small: "size-1.5",
} as const;

/**
 * A status dot: 7px by default, 6px (`small`) on secondary status lines
 * such as a recorder's connection. Status is never shown as a filled
 * container.
 */
export function StatusDot({
    tone,
    size = "default",
    className,
}: {
    tone: StatusTone;
    size?: keyof typeof sizeClass;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "inline-block shrink-0 rounded-full",
                sizeClass[size],
                toneClass[tone],
                className,
            )}
        />
    );
}

/** Status dot followed by a label, with no surrounding pill. */
export function StatusLine({
    tone,
    children,
    className,
}: {
    tone: StatusTone;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-2 text-sm text-muted-foreground",
                className,
            )}
        >
            <StatusDot tone={tone} />
            <span>{children}</span>
        </span>
    );
}
