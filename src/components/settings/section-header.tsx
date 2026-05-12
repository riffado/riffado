"use client";

import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    /**
     * Icon shown small + muted next to the title. The sidebar already
     * carries the section's primary icon at full size; repeating it
     * loud in the pane is redundant. Use this only when it adds info,
     * or pass `null` to skip.
     */
    icon?: LucideIcon | null;
    /** Slot rendered in the top-right (e.g. an "Add" button). */
    action?: React.ReactNode;
    className?: string;
}

/**
 * Standardized header for every settings section. Replaces the
 * ad-hoc `<h2 className="text-lg font-semibold flex items-center gap-2">
 * <Icon className="w-5 h-5" /> Title</h2>` duplicated across 11 files.
 *
 * Visual tradeoffs:
 *   - Title is `text-base` (not text-lg) — the sidebar selection +
 *     dialog header already communicate "this is the section"; the
 *     pane header doesn't need to shout.
 *   - Icon shrinks to size-4 and goes muted-foreground — supportive,
 *     not competitive.
 *   - Optional one-line description below the title for sections
 *     where the name alone isn't self-explanatory.
 */
export function SettingsSectionHeader({
    title,
    description,
    icon: Icon,
    action,
    className,
}: SectionHeaderProps) {
    return (
        <div
            className={cn(
                "flex items-start justify-between gap-4 pb-1",
                className,
            )}
        >
            <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                    {Icon && (
                        <Icon
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                        />
                    )}
                    <span>{title}</span>
                </h2>
                {description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    );
}
