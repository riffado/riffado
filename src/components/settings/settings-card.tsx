"use client";

import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
    /**
     * Optional card title. When absent, the card renders as a plain
     * surface; the children handle their own structure (useful when a
     * subsystem only has a single setting and a title would feel like
     * noise).
     */
    title?: React.ReactNode;
    /** Optional short description rendered under the title. */
    description?: React.ReactNode;
    /** Optional icon shown next to the title at a restrained size. */
    icon?: LucideIcon;
    /** Slot rendered in the top-right of the header (e.g. a Switch). */
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

/**
 * Visual grouping primitive for settings sections.
 *
 * Each "subsystem" inside a section (Browser notifications, Email
 * notifications, Bark, …) wraps in a SettingsCard so related controls
 * read as one unit. The card itself is a subtle surface — border +
 * radius + padding — not a heavy raised card; settings should still
 * feel like a flat document, not a dashboard.
 */
export function SettingsCard({
    title,
    description,
    icon: Icon,
    action,
    children,
    className,
}: SettingsCardProps) {
    return (
        <div
            className={cn(
                "rounded-lg border bg-card/40 px-4 py-3.5",
                className,
            )}
        >
            {(title || description || action) && (
                <div className="flex items-start justify-between gap-4 pb-3">
                    <div className="min-w-0 flex-1">
                        {title && (
                            <div className="flex items-center gap-2 text-sm font-medium">
                                {Icon && (
                                    <Icon
                                        className="size-4 text-muted-foreground"
                                        aria-hidden="true"
                                    />
                                )}
                                <span>{title}</span>
                            </div>
                        )}
                        {description && (
                            <p className="mt-1 text-xs text-muted-foreground">
                                {description}
                            </p>
                        )}
                    </div>
                    {action && <div className="shrink-0">{action}</div>}
                </div>
            )}
            <div className={cn(title || description ? "space-y-3" : "")}>
                {children}
            </div>
        </div>
    );
}
