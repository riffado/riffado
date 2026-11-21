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

/** A 7px status dot. Status is never shown as a filled container. */
export function StatusDot({
    tone,
    className,
}: {
    tone: StatusTone;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "inline-block size-[7px] shrink-0 rounded-full",
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
