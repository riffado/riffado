"use client";

import type * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

interface SettingsPageHeaderProps {
    title: React.ReactNode;
    /** One line under the title. No trailing period. */
    description?: React.ReactNode;
    className?: string;
}

/**
 * Title block at the top of every settings page: Funnel Display page
 * title and one subtitle line, as in the settings artboards.
 */
export function SettingsPageHeader({
    title,
    description,
    className,
}: SettingsPageHeaderProps) {
    return (
        <header className={cn("flex flex-col gap-3", className)}>
            <h1 className="font-display text-page-title font-medium text-strong max-sm:text-plan-title">
                {title}
            </h1>
            {description && (
                <p className="max-w-155 text-reading text-subtle max-sm:text-ui">
                    {description}
                </p>
            )}
        </header>
    );
}

interface SectionHeaderProps {
    title: React.ReactNode;
    /** One line under the heading. No trailing period. */
    description?: React.ReactNode;
    /** Slot on the right (e.g. an "Add" button). */
    action?: React.ReactNode;
    /** Heading id, for `aria-labelledby` on the group it titles. */
    id?: string;
    className?: string;
}

/**
 * Heading for one group on a settings page ("Sources", "Sync", "API
 * keys"): 22px Funnel Display with an optional subtitle and action.
 */
export function SettingsSectionHeader({
    title,
    description,
    action,
    id,
    className,
}: SectionHeaderProps) {
    return (
        <div
            className={cn(
                "flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start max-sm:gap-3",
                className,
            )}
        >
            <div className="flex min-w-0 flex-col gap-1.5">
                <h2
                    id={id}
                    className="font-display text-section-title font-semibold text-strong"
                >
                    {title}
                </h2>
                {description && (
                    <p className="text-row font-normal leading-5 text-subtle">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="flex shrink-0 gap-2">{action}</div>}
        </div>
    );
}

/**
 * One group on a settings page: heading plus content, spaced as in the
 * artboards. `anchorId` makes the group a scroll target for old section
 * links (`#sync` lands on the Sync group of Recorders).
 */
export function SettingsGroup({
    title,
    description,
    action,
    anchorId,
    children,
    className,
}: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    anchorId?: string;
    children: React.ReactNode;
    className?: string;
}) {
    const generatedId = useId();
    const headingId = anchorId ? `${anchorId}-heading` : generatedId;
    return (
        <section
            id={anchorId}
            aria-labelledby={title ? headingId : undefined}
            className={cn("flex scroll-mt-8 flex-col gap-4", className)}
        >
            {title && (
                <SettingsSectionHeader
                    id={headingId}
                    title={title}
                    description={description}
                    action={action}
                />
            )}
            {children}
        </section>
    );
}
