"use client";

import type * as React from "react";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { cn } from "@/lib/utils";

/**
 * Stack of settings rows separated by hairlines, with a hairline above the
 * first and below the last row (settings artboards). Children are
 * `SettingsRow`, `ToggleRow` or `DetailRow`.
 */
export function SettingsRows({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex flex-col divide-y divide-hairline border-y border-hairline",
                className,
            )}
        >
            {children}
        </div>
    );
}

function RowText({
    label,
    description,
    disabled,
    labelFor,
}: {
    label: React.ReactNode;
    description?: React.ReactNode;
    disabled?: boolean;
    labelFor?: string;
}) {
    const LabelTag = labelFor ? "label" : "span";
    return (
        <div
            className={cn(
                "flex min-w-0 flex-1 basis-60 flex-col gap-0.75",
                disabled && "opacity-60",
            )}
        >
            <LabelTag
                htmlFor={labelFor}
                className="text-row font-semibold text-strong"
            >
                {label}
            </LabelTag>
            {description && (
                <span className="text-ui text-subtle">{description}</span>
            )}
        </div>
    );
}

/**
 * Row with a title, an optional one-line description and a control on the
 * right (a select, an input, buttons). The control wraps under the text
 * when the row is too narrow. `controlId` ties the title to the control.
 */
export function SettingsRow({
    label,
    description,
    control,
    controlId,
    disabled,
    children,
    className,
}: {
    label: React.ReactNode;
    description?: React.ReactNode;
    control?: React.ReactNode;
    controlId?: string;
    disabled?: boolean;
    /** Extra content under the row text, full width (hints, inline status). */
    children?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col gap-3 py-4", className)}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <RowText
                    label={label}
                    description={description}
                    disabled={disabled}
                    labelFor={controlId}
                />
                {control && (
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        {control}
                    </div>
                )}
            </div>
            {children}
        </div>
    );
}

interface ToggleRowProps {
    id: string;
    label: React.ReactNode;
    description?: React.ReactNode;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    /**
     * When true (default) the whole row is a `<label>` for the switch, so
     * a click anywhere on it toggles. Set false if the row holds other
     * interactive children.
     */
    rowClickable?: boolean;
    className?: string;
}

/**
 * Title + description + ink switch, the most common settings row.
 */
export function ToggleRow({
    id,
    label,
    description,
    checked,
    onCheckedChange,
    disabled = false,
    rowClickable = true,
    className,
}: ToggleRowProps) {
    const row = (
        <div
            className={cn(
                "flex items-center gap-6 py-4",
                rowClickable && !disabled && "cursor-pointer",
                className,
            )}
        >
            <RowText
                label={label}
                description={description}
                disabled={disabled}
            />
            <SettingsSwitch
                id={id}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
            />
        </div>
    );

    if (!rowClickable) return row;

    return (
        <label htmlFor={id} className="block select-none">
            {row}
        </label>
    );
}

/**
 * Read-only label and value on one line ("Signed in as", "Plaud server").
 */
export function DetailRow({
    label,
    value,
    className,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex items-center justify-between gap-4 py-3 text-ui",
                className,
            )}
        >
            <span className="shrink-0 text-subtle">{label}</span>
            <span className="min-w-0 truncate text-right font-medium text-strong">
                {value}
            </span>
        </div>
    );
}

/** Placeholder rows at the size of the loaded list, so nothing jumps. */
export function SettingsRowsSkeleton({ rows }: { rows: number }) {
    return (
        <output
            className="flex flex-col divide-y divide-hairline border-y border-hairline"
            aria-busy="true"
            aria-label="Loading"
        >
            {Array.from({ length: rows }, (_, i) => (
                <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                    key={i}
                    className="flex h-18 items-center gap-6"
                >
                    <div className="flex flex-1 flex-col gap-2">
                        <div className="h-3.5 w-48 animate-pulse rounded-full bg-surface" />
                        <div className="h-3 w-72 max-w-full animate-pulse rounded-full bg-surface" />
                    </div>
                </div>
            ))}
        </output>
    );
}
