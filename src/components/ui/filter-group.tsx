"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { touchTargetClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Single-choice filter row (e.g. All / Untranscribed). Small-radius
 * chips, never pills; the selected chip is ink. Always has a value:
 * clicking the selected chip again keeps it selected.
 */
export function FilterGroup<T extends string>({
    value,
    onValueChange,
    options,
    className,
    ...props
}: {
    value: T;
    onValueChange: (next: T) => void;
    options: readonly { value: T; label: string }[];
    className?: string;
} & Pick<React.ComponentProps<"div">, "aria-label">) {
    return (
        <ToggleGroupPrimitive.Root
            type="single"
            value={value}
            onValueChange={(next) => {
                if (next) onValueChange(next as T);
            }}
            className={cn("flex gap-1.5", className)}
            {...props}
        >
            {options.map((option) => (
                <ToggleGroupPrimitive.Item
                    key={option.value}
                    value={option.value}
                    className={cn(
                        "squircle relative inline-flex h-7.5 items-center rounded-[var(--radius-inner)] border border-border px-3 text-small leading-4 font-medium text-foreground outline-none select-none",
                        "motion-press data-[state=off]:hover:bg-accent",
                        touchTargetClass,
                        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        "data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-background",
                        "dark:data-[state=on]:border-strong dark:data-[state=on]:bg-strong dark:data-[state=on]:text-ink",
                    )}
                >
                    {option.label}
                </ToggleGroupPrimitive.Item>
            ))}
        </ToggleGroupPrimitive.Root>
    );
}
