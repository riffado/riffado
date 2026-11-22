"use client";

import type * as React from "react";
import { SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Select trigger as drawn in the settings artboards: 38px tall, control
 * radius, medium ink label. Use it in place of `SelectTrigger` inside a
 * `Select`; everything else (content, items, keyboard) is the shared
 * Radix select.
 */
export function SettingsSelectTrigger({
    className,
    ...props
}: React.ComponentProps<typeof SelectTrigger>) {
    return (
        <SelectTrigger
            className={cn(
                "squircle h-9.5 max-w-full gap-2 rounded-[var(--radius-control)] border-border bg-reader pr-3 pl-3.5 text-ui font-medium text-strong shadow-none data-[size=default]:h-9.5 dark:bg-transparent [&>svg]:size-3.5 [&>svg]:text-subtle [&>svg]:opacity-100",
                className,
            )}
            {...props}
        />
    );
}
