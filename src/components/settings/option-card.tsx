"use client";

import type { LucideIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Radio group of option cards. Keyboard (arrow keys, roving focus) and
 * radio semantics come from Radix RadioGroup.
 */
export function OptionCardGroup({
    value,
    onValueChange,
    label,
    children,
    className,
}: {
    value: string | undefined;
    onValueChange: (value: string) => void;
    /** Accessible name of the group. */
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <RadioGroupPrimitive.Root
            value={value ?? ""}
            onValueChange={onValueChange}
            aria-label={label}
            className={cn("flex flex-col gap-3", className)}
        >
            {children}
        </RadioGroupPrimitive.Root>
    );
}

interface OptionCardProps {
    value: string;
    selected: boolean;
    icon: LucideIcon;
    title: React.ReactNode;
    description?: React.ReactNode;
    /** Secondary actions on the card (edit, delete). Clicks don't select. */
    actions?: React.ReactNode;
    /** Inset panel under the title, e.g. a status line. */
    children?: React.ReactNode;
    disabled?: boolean;
    onSelect: (value: string) => void;
}

/**
 * Radio card from the settings artboards: icon tile, title, description
 * and a radio on the right. Selected is an ink border and an ink icon
 * tile; the border width stays the same so nothing shifts. A click
 * anywhere on the card selects it.
 */
export function OptionCard({
    value,
    selected,
    icon: Icon,
    title,
    description,
    actions,
    children,
    disabled = false,
    onSelect,
}: OptionCardProps) {
    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut; the radio inside is the keyboard target
        // biome-ignore lint/a11y/noStaticElementInteractions: same as above
        <div
            onClick={(e) => {
                if (disabled || selected) return;
                // The radio handles its own clicks through the group.
                if ((e.target as HTMLElement).closest('[role="radio"]')) return;
                onSelect(value);
            }}
            className={cn(
                "squircle flex flex-col gap-3.5 rounded-[var(--radius-card)] border bg-reader p-5 transition-[border-color,box-shadow] duration-150 ease-out",
                selected
                    ? "border-strong shadow-[inset_0_0_0_0.5px_var(--strong)]"
                    : "border-border",
                disabled ? "cursor-default" : !selected && "cursor-pointer",
            )}
        >
            <div className="flex items-start gap-4">
                <span
                    aria-hidden="true"
                    className={cn(
                        "squircle flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors duration-150 ease-out max-sm:hidden",
                        selected
                            ? "bg-strong text-background"
                            : "bg-surface text-foreground",
                        disabled && "opacity-60",
                    )}
                >
                    <Icon className="size-5" />
                </span>
                <div
                    className={cn(
                        "flex min-w-0 flex-1 flex-col gap-1",
                        disabled && "opacity-60",
                    )}
                >
                    <span className="text-option font-semibold text-strong">
                        {title}
                    </span>
                    {description && (
                        <span className="text-ui leading-5 text-subtle">
                            {description}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {actions && (
                        // biome-ignore lint/a11y/noStaticElementInteractions: stops card selection when an action is used
                        // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
                        <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {actions}
                        </div>
                    )}
                    <RadioGroupPrimitive.Item
                        value={value}
                        disabled={disabled}
                        aria-label={typeof title === "string" ? title : value}
                        className="ml-1 flex size-5.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border outline-none transition-colors duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 data-[state=checked]:border-strong data-[state=checked]:bg-strong"
                    >
                        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-background" />
                    </RadioGroupPrimitive.Item>
                </div>
            </div>
            {children && <div className="sm:ml-15">{children}</div>}
        </div>
    );
}

/**
 * Inset status strip inside an option card ("Up to 15h of transcription
 * per month"): cream fill, item radius.
 */
export function OptionCardPanel({
    children,
    trailing,
}: {
    children: React.ReactNode;
    trailing?: React.ReactNode;
}) {
    return (
        <div className="squircle flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[var(--radius-item)] bg-background px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-ui text-strong">
                {children}
            </div>
            {trailing && (
                <div className="text-small leading-4 text-subtle">
                    {trailing}
                </div>
            )}
        </div>
    );
}
