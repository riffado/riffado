"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
    /**
     * Optional card title. When absent, the card renders as a plain
     * surface and the children handle their own structure.
     */
    title?: React.ReactNode;
    /** Optional short description under the title. No trailing period. */
    description?: React.ReactNode;
    /** Slot on the right of the header (e.g. buttons or a switch). */
    action?: React.ReactNode;
    /**
     * `default`: white card with a border, for things the user acts on.
     * `quiet`: cream fill with a hairline, for read-only readouts such as
     * usage meters.
     */
    tone?: "default" | "quiet";
    children?: React.ReactNode;
    className?: string;
}

/**
 * Card surface for settings, drawn like the artboards: card radius with
 * continuous corners, 20px padding, header with title, description and
 * an action slot.
 */
export function SettingsCard({
    title,
    description,
    action,
    tone = "default",
    children,
    className,
}: SettingsCardProps) {
    const hasHeader = Boolean(title || description || action);
    return (
        <div
            className={cn(
                "squircle flex flex-col gap-4 rounded-[var(--radius-card)] border p-5",
                tone === "default"
                    ? "border-border bg-reader dark:bg-card"
                    : "border-hairline bg-background",
                className,
            )}
        >
            {hasHeader && (
                <div className="flex items-start justify-between gap-4 max-sm:flex-col">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {title && (
                            <div className="text-option font-semibold text-strong">
                                {title}
                            </div>
                        )}
                        {description && (
                            <div className="text-ui text-subtle">
                                {description}
                            </div>
                        )}
                    </div>
                    {action && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                            {action}
                        </div>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}
