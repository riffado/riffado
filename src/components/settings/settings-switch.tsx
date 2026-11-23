"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The settings toggle: 40x24, ink when on (DESIGN.md: several toggles on
 * one screen would otherwise spend the accent). The off track is dark
 * enough that track and thumb both read at 3:1. Behaviour and focus come
 * from Radix Switch; only the paint differs from `ui/switch`.
 */
export function SettingsSwitch({
    className,
    ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="settings-switch"
            className={cn(
                "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-150 ease-(--ease-in-out) focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-strong data-[state=unchecked]:bg-muted-foreground dark:data-[state=unchecked]:bg-border",
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-reader shadow-xs transition-transform duration-150 ease-(--ease-in-out) data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-background dark:data-[state=unchecked]:bg-foreground" />
        </SwitchPrimitive.Root>
    );
}
